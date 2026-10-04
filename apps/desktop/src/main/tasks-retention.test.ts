import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import { expect, it } from 'vitest';
import { AUTO_MERGE_KEY } from '../shared/ipc';
import {
  repo,
  worktree,
  db,
  projects,
  tasks,
  projectId,
  taskId,
  runId,
  scope,
  expectMergedWithoutCard,
  resetTaskRuns,
} from './task-run-test-support';

it('retains the actual checkout and ignored data after the task merge is confirmed', async () => {
  const result = await tasks.mergeTask(
    { summary: 'Preserved runtime' },
    { kind: 'task', projectId, taskId, runId },
  );
  expect(result.isError).not.toBe(true);
  const view = await tasks.open(projectId, taskId);
  const card = view.timeline?.interactions.find((i) => i.kind === 'merge');
  expect(card).toBeDefined();
  await tasks.merge(projectId, taskId, card!.id, {
    action: 'confirm',
    message: 'merge retained task',
  });
  expect(existsSync(worktree)).toBe(true);
  expect(await readFile(join(worktree, 'data', 'postgres', 'PG_VERSION'), 'utf8')).toBe('16');
  expect(await readFile(join(repo, 'feature.txt'), 'utf8')).toBe('feature');
  expect(await projects.get(projectId).git.branchExists('skaro/retain')).toBe(true);
  expect(db.getRun(runId)?.outcome).toBe('done');
});

it('blocks task deletion before changing its run record when ignored data is present', async () => {
  await expect(tasks.forget(projectId, taskId)).rejects.toThrow('ignored');
  expect(db.getRun(runId)?.endedAt).toBeUndefined();
  expect(existsSync(worktree)).toBe(true);
  expect((await tasks.open(projectId, taskId)).run?.id).toBe(runId);
});

it('refreshes a blocked card after local edits disappear without another agent turn', async () => {
  await writeFile(join(repo, 'feature.txt'), 'local work');
  await tasks.mergeTask({}, { kind: 'task', projectId, taskId, runId });
  const initial = (await tasks.open(projectId, taskId)).timeline?.interactions.find(
    (i) => i.kind === 'merge',
  );
  expect(initial?.kind === 'merge' && initial.blockers).toContain('dirty_base');
  expect(initial?.kind === 'merge' && initial.localChanges).toEqual(['feature.txt']);
  await rm(join(repo, 'feature.txt'));
  await expect
    .poll(
      async () => {
        const card = (await tasks.open(projectId, taskId)).timeline?.interactions.find(
          (i) => i.kind === 'merge',
        );
        return card?.kind === 'merge' ? { id: card.id, blockers: card.blockers } : undefined;
      },
      { timeout: 10_000 },
    )
    .toEqual({ id: initial!.id, blockers: [] });
});

it('honors automatic merging for concurrent merge_task calls and repeats without another merge', async () => {
  db.setSetting(AUTO_MERGE_KEY, true);
  const results = await Promise.all([
    tasks.mergeTask({ commitMessage: ':bug: fix: preserve automatic mode' }, scope()),
    tasks.mergeTask({}, scope()),
  ]);
  const commit = await expectMergedWithoutCard();
  for (const result of results) {
    expect(result.isError).not.toBe(true);
    expect(result.text).toContain(commit.slice(0, 7));
  }
  const repeated = await tasks.mergeTask({ commitMessage: 'do not commit this' }, scope());
  expect(repeated.text).toContain('already merged');
  expect(await expectMergedWithoutCard()).toBe(commit);
});

it('returns the recorded merge after submit_result, including after restoring the run', async () => {
  db.setSetting(AUTO_MERGE_KEY, true);
  const submitted = await tasks.submitResult(
    {
      summary: 'Checked preservation',
      commitMessage: ':bug: fix: retain checkout',
      criteria: [{ number: 1, met: true, evidence: 'Existing retention scenario' }],
    },
    scope(),
  );
  const commit = await expectMergedWithoutCard();
  expect(submitted.text).toContain(commit.slice(0, 7));
  expect(submitted.text).toContain('Do not call merge_task');
  const repeatedReport = await tasks.submitResult(
    {
      summary: 'Repeated verification',
      commitMessage: 'do not commit again',
      criteria: [{ number: 1, met: true, evidence: 'Same verified criterion' }],
    },
    scope(),
  );
  expect(repeatedReport.text).toContain(commit.slice(0, 7));
  await tasks.close();
  resetTaskRuns();
  await tasks.open(projectId, taskId);
  const repeated = await tasks.mergeTask({}, scope());
  expect(repeated.isError).not.toBe(true);
  expect(repeated.text).toContain(commit.slice(0, 7));
  expect(await expectMergedWithoutCard()).toBe(commit);
});

it('keeps a blocked automatic merge in the existing card and preserves local edits', async () => {
  db.setSetting(AUTO_MERGE_KEY, true);
  await writeFile(join(repo, 'feature.txt'), 'owner edits');
  const result = await tasks.mergeTask({}, scope());
  expect(result.text).toContain('blocked');
  expect(db.listMerges(projectId, taskId)).toEqual([]);
  expect(await readFile(join(repo, 'feature.txt'), 'utf8')).toBe('owner edits');
  const card = (await tasks.open(projectId, taskId)).timeline?.interactions.find(
    (i) => i.kind === 'merge',
  );
  expect(card?.kind === 'merge' && card.blockers).toContain('dirty_base');
});

it('does not merge incomplete criteria even in automatic mode', async () => {
  db.setSetting(AUTO_MERGE_KEY, true);
  await projects.get(projectId).store.updateTask(taskId, {
    body: '## Критерии приёмки\n\n- [ ] Preserve runtime\n',
  });
  const head = (await git(repo, ['rev-parse', 'main'])).stdout;
  const result = await tasks.mergeTask({}, scope());
  expect(result.isError).toBe(true);
  expect(result.text).toContain('not ticked');
  expect(db.listMerges(projectId, taskId)).toEqual([]);
  expect((await git(repo, ['rev-parse', 'main'])).stdout).toBe(head);
  expect((await tasks.open(projectId, taskId)).timeline?.interactions).toEqual([]);
});

it('does not claim a merge or commit remaining files for a task completed without a merge record', async () => {
  await projects.get(projectId).store.updateTask(taskId, { status: 'done' });
  const head = (await git(worktree, ['rev-parse', 'HEAD'])).stdout;
  const result = await tasks.mergeTask({}, scope());
  expect(result.isError).not.toBe(true);
  expect(result.text).toContain('already completed');
  expect(result.text).not.toContain('already merged');
  expect(db.listMerges(projectId, taskId)).toEqual([]);
  expect((await git(worktree, ['rev-parse', 'HEAD'])).stdout).toBe(head);
  expect((await tasks.open(projectId, taskId)).timeline?.interactions).toEqual([]);
});

it('closes an obsolete merge card when a completed task is reopened', async () => {
  await tasks.mergeTask({}, scope());
  expect((await tasks.open(projectId, taskId)).timeline?.interactions).toHaveLength(1);
  await projects.get(projectId).store.updateTask(taskId, { status: 'done' });
  projects.get(projectId).invalidate();
  const reopened = await tasks.open(projectId, taskId);
  expect(reopened.task.status).toBe('done');
  expect(reopened.timeline?.interactions).toEqual([]);
  expect(reopened.timeline?.status).toBe('idle');
  expect(db.getTaskRuntime(projectId).get(taskId)).toBeUndefined();

  await tasks.close();
  resetTaskRuns();
  const restored = await tasks.open(projectId, taskId);
  expect(restored.task.status).toBe('done');
  expect(restored.timeline?.status).toBe('idle');
  expect(db.getTaskRuntime(projectId).get(taskId)).toBeUndefined();
});
