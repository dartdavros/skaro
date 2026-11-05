import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CompletionFixture } from './completion-test-support';
import { conflictingResults, stageResolution, behaviorCheck } from './integration-test-support';
import { IntegrationPending } from './integration-model';
import { recoverVerifiedC4Candidate } from './integration-c4-recovery';
import { C4PublicationError } from './c4-candidate';
import { TaskRunEngine } from './task-run-engine';
import { completionTaskDeps } from './completion-task-runs';
import { readTaskC4Scope } from './c4-task-scope';

let f: CompletionFixture;
let engine: TaskRunEngine | undefined;
beforeEach(async () => {
  f = await CompletionFixture.create();
});
afterEach(async () => {
  await engine?.sessions.close();
  engine = undefined;
  await f.close();
}, 60_000);

async function reference(path: string) {
  const file = join(f.repo, '.skaro/c4/model.json');
  const model = JSON.parse(await readFile(file, 'utf8'));
  model.elements[0].code = [path];
  await writeFile(file, JSON.stringify(model));
  f.context.invalidate();
}

async function candidate() {
  await reference('README.md');
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
  const op = f.integrations.deps.store.all(f.projectId)[0]!;
  await stageResolution(op);
  return op;
}

it('recovers a previously verified rename and atomically publishes matching C4 and code', async () => {
  const op = await candidate();
  const inputs = JSON.stringify(op.results);
  await git(op.worktree, ['mv', 'README.md', 'renamed.md']);
  const scope = await readTaskC4Scope(op.worktree, op.baseHead, await f.context.load(), op.taskId);
  expect(scope.files).toEqual(expect.arrayContaining(['README.md', 'renamed.md']));
  await f.integrations.verify(op, [behaviorCheck], {});
  const head = op.head;
  op.state = 'failed';
  op.error = 'repository: missing code path README.md';
  op.attempts = 3;
  f.integrations.save(op);
  await f.restart();
  const restored = f.integrations.deps.store.find(f.projectId, op.id)!;
  expect(await recoverVerifiedC4Candidate(f.integrations, restored)).toBe(true);
  expect(restored.head).toBe(head);
  await f.coordinator.publishCandidate(restored);
  expect(restored.state).toBe('applied');
  const model = JSON.parse(await readFile(join(f.repo, '.skaro/c4/model.json'), 'utf8'));
  expect(model.elements[0].code).toEqual(['renamed.md']);
  expect(await readFile(join(f.repo, 'renamed.md'), 'utf8')).toBe('initial\n');
  expect(JSON.stringify(restored.results)).toBe(inputs);
  expect((await git(f.repo, ['show', 'HEAD:.skaro/c4/model.json'])).stdout).toContain('renamed.md');
}, 60_000);

it('rejects deletion without a proven rename before running checks or marking ready', async () => {
  const op = await candidate();
  await git(op.worktree, ['rm', 'README.md']);
  await expect(f.integrations.verify(op, [behaviorCheck], {})).rejects.toBeInstanceOf(
    C4PublicationError,
  );
  expect(op.state).toBe('resolving');
  expect(op.verification).toBeUndefined();
  expect(op.checkRuns ?? []).toHaveLength(0);
  expect(op.error).toContain('missing code path README.md');
  expect(await recoverVerifiedC4Candidate(f.integrations, op)).toBe(false);
}, 60_000);

it('stops a deterministic C4 failure without another resolver turn or a success notice', async () => {
  const op = await candidate();
  await f.integrations.verify(op, [behaviorCheck], {});
  const file = join(f.repo, '.skaro/c4/model.json');
  const model = JSON.parse(await readFile(file, 'utf8'));
  model.elements.push({ ...model.elements[0], id: 'late-code', code: ['missing.py'] });
  await writeFile(file, JSON.stringify(model));
  f.context.invalidate();
  op.attempts = 1;
  f.integrations.save(op);
  engine = new TaskRunEngine(completionTaskDeps(f), 1);
  engine.integrations.enqueue(op);
  const deadline = Date.now() + 30_000;
  for (;;) {
    const saved = engine.integrations.store.find(f.projectId, op.id)!;
    if (saved.state === 'failed' && !saved.executor) break;
    if (Date.now() > deadline) throw new Error('C4 failure did not stop');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const saved = engine.integrations.store.find(f.projectId, op.id)!;
  expect(saved.attempts).toBe(1);
  expect(saved.verification).toBeUndefined();
  expect(saved.publishFailures ?? 0).toBe(0);
  expect(engine.queue.state().queued).toEqual([]);
  const history = await engine.integrations.history.state(saved);
  expect(JSON.stringify(history)).not.toContain('Интеграция проверена');
}, 60_000);
