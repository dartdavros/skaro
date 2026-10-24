import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { CompletionFixture } from './completion-test-support';
import { conflictingResults, stageResolution, behaviorCheck } from './integration-test-support';
import { IntegrationFailed, IntegrationPending } from './integration-model';
import { admitIntegration, commitIntegration } from './integration-git';
import { integrationChecks } from './integration-checks';

let f: CompletionFixture;
beforeEach(async () => {
  f = await CompletionFixture.create();
});
afterEach(async () => {
  await f.close();
});

it.each(['squash', 'merge', 'rebase'] as const)(
  'publishes a candidate resolved before merges went per task with %s, accepted inputs unchanged',
  async (strategy) => {
    const config = (await f.context.load()).config;
    await f.context.store.writeConfig({ ...config, merge: { ...config.merge, strategy } });
    const { stage, before, results, a, b } = await conflictingResults(f);
    await expect(
      f.integrations.prepare({
        projectId: f.projectId,
        taskId: results[0]!.taskId,
        purpose: 'publication',
        base: 'main',
        results,
        checks: [],
        target: stage.id,
        publish: true,
      }),
    ).rejects.toBeInstanceOf(IntegrationPending);
    const op = f.integrations.deps.store.all(f.projectId)[0]!;
    expect(op).toMatchObject({ state: 'resolving', conflicts: ['shared.txt'], baseHead: before });
    await stageResolution(op);
    await f.integrations.verify(op, [behaviorCheck], {});
    expect(op.verification?.head).toBe(op.head);
    expect(op.checkRuns?.[0]).toMatchObject({ head: op.head, state: 'passed' });
    const commit = await f.coordinator.publishCandidate(op);
    expect(f.integrations.deps.store.find(f.projectId, op.id)?.state).toBe('applied');
    expect(await readFile(join(f.repo, 'shared.txt'), 'utf8')).toBe('both accepted behaviors\n');
    expect(await f.context.git.head()).toBe(commit.commit);
    expect(await f.context.git.head('HEAD', a)).toBe(results[0]!.head);
    expect(await f.context.git.head('HEAD', b)).toBe(results[1]!.head);
    expect(await f.context.git.head('HEAD', op.worktree)).toBe(op.head);
  },
  45_000,
);

it('recovers a staged merge commit checkpoint after restart without another commit', async () => {
  const { results, before } = await conflictingResults(f);
  const request = {
    projectId: f.projectId,
    taskId: results[0]!.taskId,
    purpose: 'publication' as const,
    base: 'main',
    results,
    checks: [],
  };
  await expect(f.integrations.prepare(request)).rejects.toBeInstanceOf(IntegrationPending);
  const op = f.integrations.deps.store.all(f.projectId)[0]!;
  await stageResolution(op);
  await expect(
    commitIntegration(op, (value) => {
      f.integrations.save(value);
      if (value.commitIntent) throw new Error('crash after durable intent');
    }),
  ).rejects.toThrow('crash after durable intent');
  const intended = op.commitIntent!.head;
  await f.restart();
  const saved = f.integrations.deps.store.find(f.projectId, op.id)!;
  await admitIntegration(f.context, saved, (value) => f.integrations.save(value));
  expect(saved.head).toBe(intended);
  expect(saved.cursor).toBe(results.length);
  expect(
    (
      await git(saved.worktree, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], {
        allowFail: true,
      })
    ).code,
  ).not.toBe(0);
  await f.integrations.verify(saved, [behaviorCheck], {});
  expect(saved.head).toBe(intended);
  expect(await f.context.git.head()).toBe(before);
}, 45_000);

it('repeats the saved failure of a candidate as a failure already recorded', async () => {
  const { results } = await conflictingResults(f);
  const request = {
    projectId: f.projectId,
    taskId: results[0]!.taskId,
    purpose: 'publication' as const,
    base: 'main',
    results,
    checks: [],
  };
  await expect(f.integrations.prepare(request)).rejects.toBeInstanceOf(IntegrationPending);
  const op = f.integrations.deps.store.all(f.projectId)[0]!;
  op.state = 'failed';
  op.error = 'usage limit reached';
  f.integrations.save(op);
  const repeated = await f.integrations.prepare(request).catch((error: unknown) => error);
  expect(repeated).toBeInstanceOf(IntegrationFailed);
  expect((repeated as Error).message).toBe('usage limit reached');
}, 45_000);

it('keeps the regression plan of an accepted base result only when preparing dependencies', async () => {
  const first = await f.task('Published behavior');
  await f.commit();
  const source = await f.checkout(first);
  await f.accept(first, source, 'shared.txt');
  const result = f.journal.result(first.id)!;
  const check = { name: 'published behavior', run: 'node -e "process.exit(0)"' };
  result.verification = [check];
  f.journal.saveResult(result);
  await f.coordinator.merge(f.projectId, first.id);
  const second = await f.task('Incoming behavior');
  await f.commit();
  await f.accept(second, await f.checkout(second), 'shared.txt');
  const request = {
    projectId: f.projectId,
    taskId: second.id,
    base: 'main',
    results: [f.journal.result(second.id)!],
    checks: [],
  };
  // A merge (D-45) does not re-run saved checks: a clean candidate without project checks is ready.
  const merge = await f.integrations.prepare({ ...request, purpose: 'publication' });
  expect(merge.baseResults?.map((item) => item.taskId)).toEqual([first.id]);
  expect(integrationChecks(merge)).toEqual([]);
  await expect(
    f.integrations.prepare({ ...request, purpose: 'dependencies' }),
  ).rejects.toBeInstanceOf(IntegrationPending);
  const op = f.integrations.deps.store
    .all(f.projectId)
    .find((item) => item.taskId === second.id && item.purpose === 'dependencies')!;
  expect(op.baseResults?.map((item) => item.taskId)).toEqual([first.id]);
  expect(integrationChecks(op)).toContainEqual(check);
}, 45_000);

it('retains failed check evidence and refuses a candidate edited after successful checks', async () => {
  const { results } = await conflictingResults(f);
  await expect(
    f.integrations.prepare({
      projectId: f.projectId,
      taskId: results[0]!.taskId,
      purpose: 'publication',
      base: 'main',
      results,
      checks: [],
    }),
  ).rejects.toBeInstanceOf(IntegrationPending);
  const op = f.integrations.deps.store.all(f.projectId)[0]!;
  await stageResolution(op);
  await expect(
    f.integrations.verify(op, [{ name: 'real failure', run: 'node -e "process.exit(7)"' }], {}),
  ).rejects.toThrow('exit 7');
  expect(op.checkRuns?.[0]?.state).toBe('failed');
  // A rejected revision is returned to the caller without replacing the recorded failure.
  await expect(
    f.integrations.verify(op, [{ ...behaviorCheck, replaces: 'never saved' }], {}),
  ).rejects.toThrow('unknown verification command');
  expect(op.error).toContain('exit 7');
  // Explicit replacement retains failed evidence without dropping unrelated checks.
  await f.integrations.verify(
    op,
    [
      {
        name: 'real failure',
        run: behaviorCheck.run,
        replaces: 'node -e "process.exit(7)"',
      },
    ],
    {},
  );
  await writeFile(join(op.worktree, 'shared.txt'), 'unverified later edit\n');
  await expect(f.integrations.assertReady(op)).rejects.toThrow('changed after verification');
}, 45_000);

it('builds a new candidate when main moves rather than publishing stale evidence', async () => {
  const { results } = await conflictingResults(f);
  const request = {
    projectId: f.projectId,
    taskId: results[0]!.taskId,
    purpose: 'publication' as const,
    base: 'main',
    results,
    checks: [],
  };
  await expect(f.integrations.prepare(request)).rejects.toBeInstanceOf(IntegrationPending);
  const op = f.integrations.deps.store.all(f.projectId)[0]!;
  await stageResolution(op);
  await f.integrations.verify(op, [behaviorCheck], {});
  await writeFile(join(f.repo, 'later.txt'), 'new base behavior\n');
  await f.commit();
  const nextBase = await f.context.git.head();
  await expect(f.integrations.prepare(request)).rejects.toBeInstanceOf(IntegrationPending);
  const next = f.integrations.deps.store.all(f.projectId).find((value) => value.id !== op.id)!;
  expect(next.baseHead).toBe(nextBase);
  expect(next.verification).toBeUndefined();
  expect(f.integrations.deps.store.find(f.projectId, op.id)?.state).toBe('stale');
}, 45_000);
