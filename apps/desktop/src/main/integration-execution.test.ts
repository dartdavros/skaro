import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { submitResultTool } from '@skaro/mcp-server';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CompletionFixture } from './completion-test-support';
import { completionTaskDeps } from './completion-task-runs';
import { TaskRunEngine } from './task-run-engine';
import { IntegrationPending } from './integration-model';
import { conflictingResults } from './integration-test-support';
import { AUTO_MERGE_KEY } from '../shared/ipc';

let f: CompletionFixture;
let engine: TaskRunEngine | undefined;
beforeEach(async () => {
  f = await CompletionFixture.create();
});
afterEach(async () => {
  const fixture = f;
  const current = engine;
  engine = undefined;
  await current?.sessions.close();
  await fixture.close();
}, 120_000);

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error('Integration did not reach its expected checkpoint');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** A candidate as the ones still in flight from before merges went per task. */
async function candidate(ids: string[], target: string): Promise<void> {
  engine = new TaskRunEngine(completionTaskDeps(f), 1);
  await expect(
    engine.integrations.service.prepare({
      projectId: f.projectId,
      taskId: ids[0]!,
      purpose: 'publication',
      base: 'main',
      results: ids.map((id) => f.journal.result(id)!),
      checks: (await f.context.load()).config.checks,
      target,
      publish: true,
    }),
  ).rejects.toBeInstanceOf(IntegrationPending);
}

async function acceptedWithCheck(run: string) {
  const task = await f.task('Managed check');
  const config = (await f.context.load()).config;
  await f.context.store.writeConfig({ ...config, checks: [{ name: 'real candidate check', run }] });
  await f.commit();
  await f.accept(task, await f.checkout(task));
  await candidate([task.id], task.id);
  return task;
}

it('checks and publishes a candidate still in flight in one queue slot without an agent', async () => {
  const task = await acceptedWithCheck('node -e "console.log(process.cwd())"');
  await waitFor(() => f.journal.operations().some((op) => op.state === 'completed'));
  await waitFor(() => engine!.queue.state().running.length === 0);
  const op = engine!.integrations.store.all(f.projectId)[0]!;
  expect(op.state).toBe('applied');
  expect(op.verification?.head).toBe(op.head);
  expect(op.checkRuns?.[0]?.output?.trim().toLowerCase()).toBe(op.worktree.toLowerCase());
  expect(op.attempts).toBe(0);
  expect(op.executor).toBeUndefined();
  expect((await f.context.store.readTask(task.id)).status).toBe('done');
}, 60_000);

it('stops an active real check and retains its candidate without automatic retry', async () => {
  const task = await acceptedWithCheck(
    'node -e "console.log(\'check running\');setTimeout(()=>{},60000)"',
  );
  await waitFor(() => !!engine!.integrations.store.all(f.projectId)[0]?.checkRuns?.[0]?.output);
  const saved = engine!.integrations.store.all(f.projectId)[0]!;
  await engine!.integrations.controls.interrupt(f.projectId, task.id);
  await waitFor(() => engine!.queue.state().running.length === 0);
  const paused = engine!.integrations.store.find(f.projectId, saved.id)!;
  expect(paused.state).toBe('paused');
  expect(paused.executor).toBeUndefined();
  expect(paused.attempts).toBe(0);
  expect(paused.verification).toBeUndefined();
  expect(f.db.getSetting(`run.verification-${saved.id}.processes`, [])).toEqual([]);
  expect((await f.context.store.readTask(task.id)).status).toBe('review');
}, 60_000);

it('controls a candidate still in flight from the chat of any of its tasks', async () => {
  const stage = await f.context.store.createMilestone({ title: 'Stage merge' });
  const first = await f.task('First of the stage', stage.id);
  const second = await f.task('Second of the stage', stage.id);
  const config = (await f.context.load()).config;
  await f.context.store.writeConfig({
    ...config,
    checks: [
      {
        name: 'real candidate check',
        run: 'node -e "console.log(\'check running\');setTimeout(()=>{},60000)"',
      },
    ],
  });
  await f.commit();
  await f.accept(first, await f.checkout(first));
  await f.accept(second, await f.checkout(second));
  await candidate([first.id, second.id], stage.id);
  const integrations = engine!.integrations;
  await waitFor(() => !!integrations.store.all(f.projectId)[0]?.checkRuns?.[0]?.output);
  const saved = integrations.store.all(f.projectId)[0]!;
  expect(saved.taskId).toBe(first.id);
  // The tasks stay in review; the board says on both that their merge is at work.
  const board = async () =>
    (await engine!.views.list(f.projectId)).map((task) => [task.id, task.status, task.merge]);
  expect(await board()).toEqual([
    [first.id, 'review', 'running'],
    [second.id, 'review', 'running'],
  ]);

  await engine!.messages.send(f.projectId, second.id, { text: 'keep both behaviors' });
  expect(integrations.store.inputs(saved.id)).toEqual([{ text: 'keep both behaviors' }]);

  await integrations.history.event(integrations.executing(saved.id)!, {
    t: 'interaction.opened',
    interaction: {
      kind: 'question',
      id: 'question',
      delivery: 'async',
      questions: [
        {
          id: 'order',
          header: 'Order',
          text: 'Which behavior goes first?',
          multi: false,
          allowFreeText: true,
          options: [],
        },
      ],
    },
  });
  const question = `integration-${saved.id}:question`;
  const chat = () => integrations.history.project(f.projectId, second.id);
  expect((await chat()).timeline.interactions.map((item) => item.id)).toEqual([question]);
  await engine!.messages.send(f.projectId, second.id, { text: 'Which behaviors do you mean?' });
  expect(integrations.store.inputs(saved.id).at(-1)?.text).toBe('Which behaviors do you mean?');
  expect((await chat()).timeline.interactions.map((item) => item.id)).toEqual([question]);
  await engine!.messages.respond(f.projectId, second.id, question, {
    kind: 'question',
    answers: { order: ['the first one'] },
  });
  expect(integrations.store.inputs(saved.id).at(-1)).toEqual({
    commandId: 'answers-question',
    text: 'Which behavior goes first?\nthe first one',
  });
  expect((await chat()).timeline.interactions).toEqual([]);

  await engine!.messages.interrupt(f.projectId, second.id);
  await waitFor(() => engine!.queue.state().running.length === 0);
  expect(integrations.store.find(f.projectId, saved.id)).toMatchObject({ state: 'paused' });
  expect(await board()).toEqual([
    [first.id, 'review', undefined],
    [second.id, 'review', undefined],
  ]);
  expect(f.db.getSetting(`run.verification-${saved.id}.processes`, [])).toEqual([]);
}, 60_000);

it('merges a finished task at once and hands a conflict to its own agent, with no candidate', async () => {
  f.db.setSetting(AUTO_MERGE_KEY, true);
  const first = await f.task('First');
  const second = await f.task('Second');
  await f.commit();
  await writeFile(join(await f.checkout(first), 'shared.txt'), 'first behavior\n');
  await writeFile(join(await f.checkout(second), 'shared.txt'), 'second behavior\n');
  engine = new TaskRunEngine(completionTaskDeps(f), 1);
  const runs = engine;
  const tool = submitResultTool((args, scope) => runs.results.submitResult(args, scope));
  const submit = async (taskId: string) => {
    const view = await runs.views.open(f.projectId, taskId);
    await f.review(taskId);
    // The agent calls submit_result inside its own turn.
    runs.active
      .get(`${f.projectId}\n${taskId}`)!
      .timeline.apply({ t: 'turn.started', turnId: 't' });
    return tool.call(
      {
        summary: 'Accepted result',
        commit_message: `feat: ${taskId}`,
        criteria: [{ number: 1, met: true, evidence: 'real source inspected' }],
      },
      { kind: 'task', projectId: f.projectId, taskId, runId: view.run!.id },
    );
  };
  expect((await submit(first.id)).text).toContain('merged the task branch');
  expect((await f.context.store.readTask(first.id)).status).toBe('done');
  const merged = await f.context.git.head();

  const reply = await submit(second.id);
  expect(reply.text).toContain('shared.txt');
  expect(reply.text).toContain('git merge main');
  expect((await f.context.store.readTask(second.id)).status).toBe('in_progress');
  expect(await f.context.git.head()).toBe(merged);
  expect(runs.integrations.store.all(f.projectId)).toEqual([]);

  // The board says where each merge stands: the conflict on its task, and behind which task
  // an accepted one waits in line.
  const third = await f.task('Third', undefined, [second.id]);
  await f.commit();
  await f.accept(third, await f.checkout(third));
  const board = (await runs.views.list(f.projectId)).map((task) => [
    task.id,
    task.merge,
    task.mergeAfter,
  ]);
  expect(board).toEqual([
    [first.id, undefined, undefined],
    [second.id, 'conflict', undefined],
    [third.id, 'queued', second.id],
  ]);
}, 60_000);

it('does not resume a merge candidate left from before merges went per task', async () => {
  const { results } = await conflictingResults(f);
  await expect(
    f.integrations.prepare({
      projectId: f.projectId,
      taskId: results[0]!.taskId,
      purpose: 'publication',
      base: 'main',
      results,
      checks: [],
      publish: true,
    }),
  ).rejects.toBeInstanceOf(IntegrationPending);
  const left = f.integrations.deps.store.all(f.projectId)[0]!;
  expect(left.state).toBe('resolving');
  // The start of Skaro retires it: no agent, environment or check is started for it again.
  engine = new TaskRunEngine(completionTaskDeps(f), 1);
  const store = engine.integrations.store;
  await waitFor(() => store.find(f.projectId, left.id)?.state === 'stale');
  expect(engine.queue.state()).toMatchObject({ running: [], queued: [] });
  for (const result of results)
    expect((await f.context.store.readTask(result.taskId)).status).toBe('review');
}, 60_000);
