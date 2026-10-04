import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git, indexTasks, isBlocked } from '@skaro/core';
import type { SkaroScope } from '@skaro/mcp-server';
import type { Interaction } from '@skaro/timeline';
import { beforeEach, expect, it } from 'vitest';
import { db, dir, projectId, projects, repo, tasks } from './task-run-test-support';
import { readLedger, writeLedger } from './task-stage';

const BRANCH = 'skaro/M01-stage';
let first: string;
let second: string;
let worktree: string;
let scope: SkaroScope;

/** Two tasks of one milestone; the first already works in the checkout of the stage. */
beforeEach(async () => {
  const context = projects.get(projectId);
  const stage = await context.store.createMilestone({ title: 'Stage' });
  await context.store.updateMilestone(stage.id, { branch: BRANCH });
  const body = '## Критерии приёмки\n\n- [ ] Works\n';
  first = (await context.store.createTask({ title: 'First', milestone: stage.id, body })).id;
  second = (
    await context.store.createTask({
      title: 'Second',
      milestone: stage.id,
      dependsOn: [first],
      body,
    })
  ).id;
  await context.store.updateTask(first, { status: 'in_progress' });
  context.invalidate();
  worktree = join(dir, 'worktrees', projectId, stage.id);
  await context.git.createWorktree({ path: worktree, branch: BRANCH, base: 'main' });
  const runId = db.createRun({
    projectId,
    taskId: first,
    agent: 'codex',
    worktree,
    branch: BRANCH,
    logPath: 'runs/stage.jsonl',
    adapterVersion: 'test',
  }).id;
  scope = { kind: 'task', projectId, taskId: first, runId };
  // The task began at the tip of main and made two commits of its own.
  const ledger = readLedger(db, projectId, stage.id);
  ledger.open[first] = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  writeLedger(db, projectId, stage.id, ledger);
  for (const name of ['a.txt', 'b.txt']) {
    await writeFile(join(worktree, name), name);
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-qm', `wip ${name}`]);
  }
  await writeFile(join(worktree, 'c.txt'), 'left uncommitted');
  await tasks.open(projectId, first);
});

function submit() {
  return tasks.submitResult(
    {
      summary: 'Checked',
      commitMessage: 'feat: first task of the stage',
      criteria: [{ number: 1, met: true, evidence: 'ran it' }],
    },
    scope,
  );
}

it('finishes a stage task as one commit in the stage branch, without a merge card', async () => {
  const main = (await git(repo, ['rev-parse', 'main'])).stdout.trim();
  const result = await submit();
  expect(result.isError).not.toBe(true);
  expect(result.text).toContain('merged together with its milestone');

  const context = projects.get(projectId);
  expect((await context.store.readTask(first)).status).toBe('review');
  const view = await tasks.open(projectId, first);
  expect(view.timeline?.interactions).toEqual([]);
  expect(view.timeline?.items.some((i) => i.kind === 'notice' && i.code === 'stage_done')).toBe(
    true,
  );
  // Three pieces of work became one commit; main is untouched.
  const log = (await git(repo, ['log', '--format=%s', `main..${BRANCH}`])).stdout.trim();
  expect(log).toBe('feat: first task of the stage');
  expect((await git(repo, ['rev-parse', 'main'])).stdout.trim()).toBe(main);
  expect((await git(worktree, ['status', '--porcelain'])).stdout.trim()).toBe('');
  const ledger = readLedger(db, projectId, 'M01');
  expect(ledger.open).toEqual({});
  expect(ledger.commits.map((c) => [c.taskId, c.message])).toEqual([
    [first, 'feat: first task of the stage'],
  ]);

  // Submitting again without new work adds neither a commit nor a second notice.
  await submit();
  expect(readLedger(db, projectId, 'M01').commits).toHaveLength(1);
});

it('unblocks the next task of the stage once its dependency is in review', async () => {
  const blocked = async () => {
    const context = projects.get(projectId);
    context.invalidate();
    const all = (await context.load()).tasks;
    return isBlocked(
      all.find((t) => t.id === second)!,
      indexTasks(all),
    );
  };
  expect(await blocked()).toBe(true);
  // The board does not call it blocked: tasks of a stage run in order anyway.
  const summary = async () => (await tasks.list(projectId)).find((t) => t.id === second)!;
  expect(await summary()).toMatchObject({ status: 'todo', staged: true, waitsFor: [] });
  await submit();
  expect(await blocked()).toBe(false);
});

it('does not merge a stage task on its own and keeps the stage checkout when it is deleted', async () => {
  const result = await tasks.mergeTask({ summary: 'merge it' }, scope);
  expect(result.text).toContain('not merged on its own');
  expect((await tasks.open(projectId, first)).timeline?.interactions).toEqual([]);

  await submit();
  await tasks.forget(projectId, first);
  expect(existsSync(worktree)).toBe(true);
  expect((await git(repo, ['rev-parse', '--verify', BRANCH], { allowFail: true })).code).toBe(0);
});

type MergeCard = Extract<Interaction, { kind: 'merge' }>;

async function stageCard(): Promise<MergeCard | undefined> {
  const view = await tasks.open(projectId, 'M01');
  return view.timeline?.interactions.find((i): i is MergeCard => i.kind === 'merge');
}

const mainLog = async () => (await git(repo, ['log', '--format=%s', 'main'])).stdout.split('\n');

it('merges a finished stage as a commit per task with the messages of its card, and undoes it', async () => {
  const context = projects.get(projectId);
  await context.store.updateTask(second, { status: 'cancelled' });
  context.invalidate();
  await submit();
  // Nothing to check (no readiness criterion): the card of the stage shows by itself.
  await expect.poll(stageCard, { timeout: 15_000 }).toBeDefined();
  const card = (await stageCard())!;
  expect(card.blockers).toEqual([]);
  expect(card.stage).toEqual({
    id: 'M01',
    tasks: [{ id: first, title: 'First', message: 'feat: first task of the stage' }],
    partial: false,
    unmet: [],
  });

  await tasks.merge(projectId, 'M01', card.id, {
    action: 'confirm',
    message: '',
    messages: { [first]: 'feat: renamed on the card' },
  });
  expect((await context.store.readTask(first)).status).toBe('done');
  expect(await stageCard()).toBeUndefined();
  expect((await mainLog()).slice(0, 2)).toEqual(['M01: Stage', 'feat: renamed on the card']);
  const merge = db.listMerges(projectId, 'M01')[0]!;
  expect(readLedger(db, projectId, 'M01').merged).toEqual([
    { commit: merge.commit, tasks: [first] },
  ]);

  await tasks.revertMerge(projectId, 'M01', merge.commit);
  expect((await context.store.readTask(first)).status).toBe('review');
  expect(existsSync(join(repo, 'a.txt'))).toBe(false);
}, 30_000);

it('«Влить готовое» merges the finished tasks and leaves the stage working', async () => {
  const context = projects.get(projectId);
  await submit();
  expect(await stageCard()).toBeUndefined();
  await tasks.mergeFinished(projectId, 'M01');
  const card = (await stageCard())!;
  expect(card.stage?.partial).toBe(true);
  expect(card.stage?.tasks.map((t) => t.id)).toEqual([first]);

  await tasks.merge(projectId, 'M01', card.id, { action: 'confirm', message: '' });
  expect((await context.store.readTask(first)).status).toBe('done');
  expect((await context.store.readTask(second)).status).toBe('todo');
  expect(existsSync(join(repo, 'a.txt'))).toBe(true);
  // The stage goes on from what is merged: its branch has the base, its checkout stays.
  expect(existsSync(worktree)).toBe(true);
  expect((await git(repo, ['rev-list', '--count', `${BRANCH}..main`])).stdout.trim()).toBe('0');
  const merged = (await tasks.open(projectId, 'M01')).timeline?.items.find(
    (i) => i.kind === 'notice' && i.code === 'merged',
  );
  expect(merged?.kind === 'notice' && merged.merge?.tasks).toBe(1);
}, 30_000);

it('holds the stage card back while a readiness criterion is not ticked', async () => {
  const context = projects.get(projectId);
  const stage = (await context.load()).milestones.find((m) => m.id === 'M01')!;
  await context.store.updateMilestone('M01', {
    body: `${stage.body.trimEnd()}\n\nВсё работает вместе\n`,
  });
  await context.store.updateTask(second, { status: 'cancelled' });
  context.invalidate();
  await submit();
  // The acceptance would start an agent here; none is installed, so the stage only waits.
  await tasks.mergeFinished(projectId, 'M01');
  expect((await stageCard())?.stage?.partial).toBe(true);

  // The criterion written as plain text is ticked like a list item.
  await tasks.toggleCriterion(projectId, 'M01', 0);
  const ready = (await stageCard())!;
  expect(ready.stage).toMatchObject({ partial: false, unmet: [] });
  expect(ready.blockers).toEqual([]);
  context.invalidate();
  expect((await context.load()).milestones[0]!.body).toContain('- [x] Всё работает вместе');

  await tasks.toggleCriterion(projectId, 'M01', 0);
  const held = (await stageCard())!;
  expect(held.blockers).toEqual(['criteria']);
  expect(held.stage?.unmet).toEqual(['Всё работает вместе']);
}, 30_000);
