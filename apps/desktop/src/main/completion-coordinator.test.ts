import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git, readAcceptedC4Model } from '@skaro/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AUTO_MERGE_KEY } from '../shared/ipc';
import { CompletionFixture } from './completion-test-support';

let fixture: CompletionFixture;
beforeEach(async () => {
  fixture = await CompletionFixture.create();
});
afterEach(async () => {
  await fixture.close();
});

it.each(['squash', 'merge', 'rebase'] as const)(
  'publishes the accepted tasks of a milestone one by one using %s and keeps source heads immutable',
  async (strategy) => {
    const context = fixture.context;
    const stage = await context.store.createMilestone({ title: 'Parallel stage' });
    const tasks = [await fixture.task('First', stage.id), await fixture.task('Second', stage.id)];
    const config = (await context.load()).config;
    await context.store.writeConfig({ ...config, merge: { ...config.merge, strategy } });
    await fixture.commit();
    const before = await context.git.head();
    const checkouts = await Promise.all(tasks.map((task) => fixture.checkout(task)));
    await Promise.all(tasks.map((task, i) => fixture.accept(task, checkouts[i]!)));
    const heads = tasks.map((task) => fixture.journal.result(task.id)!.head);
    const results = await Promise.all([
      fixture.coordinator.merge(fixture.projectId, stage.id),
      fixture.coordinator.merge(fixture.projectId, stage.id),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await context.git.head()).toBe(results[0]!.commit);
    expect(fixture.journal.operations()).toHaveLength(2);
    for (const [index, task] of tasks.entries()) {
      expect((await context.store.readTask(task.id)).status).toBe('done');
      expect((await git(fixture.repo, ['show', `HEAD:${task.path}`])).stdout).toContain(
        'status: done',
      );
      expect(await context.git.head(task.branch!)).toBe(heads[index]);
      expect(await readFile(join(fixture.repo, `${task.id}.txt`), 'utf8')).toBe(
        `${task.id} result\n`,
      );
      expect(fixture.db.listMerges(fixture.projectId, task.id)).toHaveLength(1);
    }
    if (strategy === 'squash')
      expect(
        Number((await git(fixture.repo, ['rev-list', '--count', `${before}..HEAD`])).stdout),
      ).toBe(2);
    const commit = results[0]!.commit;
    await fixture.restart();
    await fixture.reconcile();
    expect((await fixture.coordinator.merge(fixture.projectId, stage.id)).commit).toBe(commit);
    expect(fixture.journal.operations()).toHaveLength(2);
  },
  30_000,
);

it('automatically completes a ready milestone without any chat or synthetic run', async () => {
  const stage = await fixture.context.store.createMilestone({ title: 'Automatic stage' });
  const first = await fixture.task('First', stage.id);
  const second = await fixture.task('Second', stage.id);
  await fixture.commit();
  const a = await fixture.checkout(first);
  const b = await fixture.checkout(second);
  fixture.db.setSetting(AUTO_MERGE_KEY, true);
  fixture.coordinator.start();
  await fixture.accept(first, a);
  expect((await fixture.context.store.readTask(first.id)).status).toBe('review');
  await fixture.accept(second, b);
  await expect
    .poll(
      async () => ({
        status: (await fixture.context.store.readTask(second.id)).status,
        errors: fixture.errors,
      }),
      { timeout: 20_000 },
    )
    .toEqual({ status: 'done', errors: [] });
  await expect
    .poll(() => fixture.journal.operations().some((op) => op.state === 'completed'), {
      timeout: 10_000,
    })
    .toBe(true);
  expect((await fixture.context.store.readTask(first.id)).status).toBe('done');
  expect(fixture.db.listRuns(fixture.projectId, stage.id)).toEqual([]);
  expect(fixture.db.listMerges(fixture.projectId, first.id)).toHaveLength(1);
  expect(fixture.errors).toEqual([]);
}, 30_000);

it('preserves unrelated staged, unstaged, untracked and ignored owner data', async () => {
  const task = await fixture.task('Owner edits');
  await fixture.commit();
  const worktree = await fixture.checkout(task);
  await fixture.accept(task, worktree);
  await writeFile(join(fixture.repo, 'README.md'), 'staged owner edit\n');
  await git(fixture.repo, ['add', 'README.md']);
  await writeFile(join(fixture.repo, 'README.md'), 'unstaged owner edit\n');
  await writeFile(join(fixture.repo, 'scratch.txt'), 'untracked owner data');
  await mkdir(join(fixture.repo, 'data'));
  await writeFile(join(fixture.repo, 'data', 'database'), 'ignored owner data');
  const staged = (await git(fixture.repo, ['diff', '--cached', '--binary', '--', 'README.md']))
    .stdout;
  const unstaged = (await git(fixture.repo, ['diff', '--binary', '--', 'README.md'])).stdout;
  await fixture.coordinator.merge(fixture.projectId, task.id);
  expect(
    (await git(fixture.repo, ['diff', '--cached', '--binary', '--', 'README.md'])).stdout,
  ).toBe(staged);
  expect((await git(fixture.repo, ['diff', '--binary', '--', 'README.md'])).stdout).toBe(unstaged);
  expect(await readFile(join(fixture.repo, 'scratch.txt'), 'utf8')).toBe('untracked owner data');
  expect(await readFile(join(fixture.repo, 'data', 'database'), 'utf8')).toBe('ignored owner data');
}, 30_000);

it('completes an accepted task on an unoccupied base while the owner stays on another branch', async () => {
  const task = await fixture.task('Publish while editing another branch');
  const context = fixture.context;
  const modelPath = '.skaro/c4/model.json';
  const modelFile = join(fixture.repo, modelPath);
  const baseModel = (await readAcceptedC4Model(fixture.repo))!;
  baseModel.elements[0]!.code = ['README.md'];
  await writeFile(modelFile, JSON.stringify(baseModel));
  await fixture.commit();
  const worktree = await fixture.checkout(task);
  await git(worktree, ['mv', 'README.md', 'renamed.md']);
  await git(fixture.repo, ['switch', '-qc', 'owner-work']);
  const owner = await context.git.head();
  const localModel = structuredClone(baseModel);
  localModel.revision++;
  localModel.elements[0]!.code = ['data/other-task.txt'];
  const localArchitecture = JSON.stringify(localModel);
  await writeFile(modelFile, localArchitecture);
  for (const checkout of [fixture.repo, worktree]) {
    await mkdir(join(checkout, 'data'));
    await writeFile(join(checkout, 'data/other-task.txt'), 'other task code\n');
  }
  await fixture.accept(task, worktree);
  await writeFile(join(fixture.repo, 'README.md'), 'uncommitted owner notes\n');
  const published = await fixture.coordinator.merge(fixture.projectId, task.id);

  expect(await context.git.currentBranch()).toBe('owner-work');
  expect(await context.git.head()).toBe(owner);
  expect(await context.git.head('main')).toBe(published.commit);
  expect(await readFile(join(fixture.repo, 'README.md'), 'utf8')).toBe('uncommitted owner notes\n');
  expect(await readFile(modelFile, 'utf8')).toBe(localArchitecture);
  expect(JSON.parse((await git(fixture.repo, ['show', `main:${modelPath}`])).stdout)).toEqual(
    baseModel,
  );
  expect((await git(fixture.repo, ['diff', owner, 'main', '--', '.skaro/c4'])).stdout).toBe('');
  expect((await context.store.readTask(task.id)).status).toBe('done');
  expect((await git(fixture.repo, ['show', `main:${task.path}`])).stdout).toContain('status: done');
  expect(fixture.db.listMerges(fixture.projectId, task.id)).toMatchObject([
    { commit: published.commit },
  ]);
}, 45_000);

it('runs only the configured project checks at the merge and keeps the task in review when one fails', async () => {
  const task = await fixture.task('Checked task');
  const context = fixture.context;
  const config = (await context.load()).config;
  await context.store.writeConfig({
    ...config,
    checks: [{ name: 'required', run: 'node -e "process.exit(7)"' }],
  });
  await fixture.commit();
  await fixture.accept(task, await fixture.checkout(task));
  const before = await context.git.head();
  await expect(fixture.coordinator.merge(fixture.projectId, task.id)).rejects.toThrow('exit 7');
  // No candidate, environment or agent stands behind a merge: it is a Git operation.
  expect(fixture.integrations.deps.store.all(fixture.projectId)).toEqual([]);
  expect(await context.git.head()).toBe(before);
  expect((await context.store.readTask(task.id)).status).toBe('review');
  await context.store.writeConfig({
    ...config,
    checks: [{ name: 'required', run: 'node -e "process.exit(0)"' }],
  });
  context.invalidate();
  await fixture.coordinator.merge(fixture.projectId, task.id);
  expect((await context.store.readTask(task.id)).status).toBe('done');
}, 30_000);
