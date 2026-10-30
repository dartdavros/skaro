import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CompletionFixture } from './completion-test-support';
import { IntegrationPending, type IntegrationOperation } from './integration-model';

let fixture: CompletionFixture;
beforeEach(async () => {
  fixture = await CompletionFixture.create();
});
afterEach(async () => {
  await fixture?.close();
});

async function start() {
  const task = await fixture.task('Preserve local work');
  await fixture.commit();
  const worktree = await fixture.checkout(task);
  await fixture.accept(task, worktree, 'README.md');
  await writeFile(join(fixture.repo, 'README.md'), 'owner staged\n');
  await git(fixture.repo, ['add', 'README.md']);
  await writeFile(join(fixture.repo, 'README.md'), 'owner staged\nowner unstaged\n');
  await writeFile(join(fixture.repo, 'scratch.txt'), 'unrelated owner file\n');
  await expect(fixture.coordinator.merge(fixture.projectId, task.id)).rejects.toBeInstanceOf(
    IntegrationPending,
  );
  const op = fixture.integrations.deps.store.all(fixture.projectId).at(-1)!;
  expect(op.state).toBe('resolving');
  expect(op.publicationHead).toBeTruthy();
  expect(op.localChanges).toBeTruthy();
  return { task, op, taskText: `${task.id} result\n` };
}

async function resolve(op: IntegrationOperation, taskText: string) {
  await writeFile(join(op.worktree, 'README.md'), taskText + 'owner staged\n');
  await git(op.worktree, ['add', 'README.md']);
  const checks = [
    {
      name: 'Preserved task and local behavior',
      run: `node -e "const s=require('fs').readFileSync('README.md','utf8');for(const t of ['result','owner staged','owner unstaged'])if(!s.includes(t))throw Error(t)"`,
    },
  ];
  await fixture.integrations.verify(op, checks, {});
  expect(op.localIndexHead).toBeTruthy();
  expect(op.state).toBe('ready');
}

it.each(['squash', 'merge', 'rebase'] as const)(
  'resolves local layers with %s, survives restart and publishes only the accepted task',
  async (strategy) => {
    const config = (await fixture.context.load()).config;
    await fixture.context.store.writeConfig({ ...config, merge: { ...config.merge, strategy } });
    const { task, op, taskText } = await start();
    const before = await fixture.context.git.head();
    const originalIndex = (await git(fixture.repo, ['diff', '--cached', '--binary'])).stdout;
    await fixture.restart();
    const restored = fixture.integrations.deps.store.find(fixture.projectId, op.id)!;
    await resolve(restored, taskText);
    expect(await fixture.context.git.head()).toBe(before);
    expect((await git(fixture.repo, ['diff', '--cached', '--binary'])).stdout).toBe(originalIndex);
    expect(await readFile(join(fixture.repo, 'README.md'), 'utf8')).toBe(
      'owner staged\nowner unstaged\n',
    );
    await fixture.coordinator.publishCandidate(restored);
    expect((await fixture.context.store.readTask(task.id)).status).toBe('done');
    expect((await git(fixture.repo, ['show', 'HEAD:README.md'])).stdout).toBe(taskText);
    expect((await git(fixture.repo, ['show', ':README.md'])).stdout).toBe(
      taskText + 'owner staged\n',
    );
    expect(await readFile(join(fixture.repo, 'README.md'), 'utf8')).toBe(
      taskText + 'owner staged\nowner unstaged\n',
    );
    expect(await readFile(join(fixture.repo, 'scratch.txt'), 'utf8')).toBe(
      'unrelated owner file\n',
    );
    expect(fixture.integrations.deps.store.find(fixture.projectId, op.id)?.state).toBe('applied');
    await fixture.restart();
    await fixture.reconcile();
    expect((await fixture.context.store.readTask(task.id)).status).toBe('done');
  },
  60_000,
);

it('captures new owner edits and continues automatically instead of publishing a stale resolution', async () => {
  const { op, taskText } = await start();
  await resolve(op, taskText);
  const before = await fixture.context.git.head();
  await writeFile(join(fixture.repo, 'README.md'), 'new owner edit while resolving\n');
  await expect(fixture.coordinator.publishCandidate(op)).rejects.toBeInstanceOf(IntegrationPending);
  const next = fixture.integrations.deps.store.all(fixture.projectId).at(-1)!;
  expect(next.id).not.toBe(op.id);
  expect(next.publish).toBe(true);
  expect(next.localChanges?.id).not.toBe(op.localChanges?.id);
  expect(await fixture.context.git.head()).toBe(before);
  expect(await readFile(join(fixture.repo, 'README.md'), 'utf8')).toBe(
    'new owner edit while resolving\n',
  );
  expect(fixture.integrations.deps.store.find(fixture.projectId, op.id)?.state).toBe('stale');
}, 60_000);

it('rolls back a failed publication without losing either local layer', async () => {
  const { op, taskText } = await start();
  await resolve(op, taskText);
  const before = await fixture.context.git.head();
  const index = (await git(fixture.repo, ['diff', '--cached', '--binary'])).stdout;
  await writeFile(join(fixture.repo, '.git/refs/heads/main.lock'), 'another Git writer');
  await expect(fixture.coordinator.publishCandidate(op)).rejects.toThrow('update-ref');
  expect(await fixture.context.git.head()).toBe(before);
  expect((await git(fixture.repo, ['diff', '--cached', '--binary'])).stdout).toBe(index);
  expect(await readFile(join(fixture.repo, 'README.md'), 'utf8')).toBe(
    'owner staged\nowner unstaged\n',
  );
}, 60_000);

it('reprepares on a newer base while retaining manual publication authorization', async () => {
  const { op, taskText } = await start();
  await resolve(op, taskText);
  await writeFile(join(fixture.repo, 'parallel.txt'), 'another completed task\n');
  await git(fixture.repo, ['add', 'parallel.txt']);
  await git(fixture.repo, ['commit', '--only', '-m', 'parallel result', '--', 'parallel.txt']);
  const base = await fixture.context.git.head();
  await expect(fixture.coordinator.publishCandidate(op)).rejects.toBeInstanceOf(IntegrationPending);
  const next = fixture.integrations.deps.store.all(fixture.projectId).at(-1)!;
  expect(next.baseHead).toBe(base);
  expect(next.publish).toBe(true);
  expect(next.localChanges?.base).toBe(base);
  expect(await readFile(join(fixture.repo, 'README.md'), 'utf8')).toBe(
    'owner staged\nowner unstaged\n',
  );
  await resolve(next, taskText);
  await fixture.coordinator.publishCandidate(next);
  expect(await readFile(join(fixture.repo, 'parallel.txt'), 'utf8')).toBe(
    'another completed task\n',
  );
  expect((await git(fixture.repo, ['show', ':README.md'])).stdout).toBe(
    taskText + 'owner staged\n',
  );
}, 60_000);

it('preserves the owner edits that sit beside the merged files, not unrelated folders', async () => {
  const task = await fixture.task('Preserve related local work');
  await fixture.commit();
  const worktree = await fixture.checkout(task);
  await fixture.accept(task, worktree, 'README.md');
  // The owner's README imports an uncommitted sibling; a file elsewhere is not part of the merge.
  await writeFile(join(fixture.repo, 'README.md'), 'owner edit, see notes\n');
  await writeFile(join(fixture.repo, 'notes.md'), 'owner sibling\n');
  await mkdir(join(fixture.repo, 'other'));
  await writeFile(join(fixture.repo, 'other', 'draft.md'), 'unrelated\n');
  await expect(fixture.coordinator.merge(fixture.projectId, task.id)).rejects.toBeInstanceOf(
    IntegrationPending,
  );
  const op = fixture.integrations.deps.store.all(fixture.projectId).at(-1)!;
  expect(op.localChanges?.paths).toContain('notes.md');
  expect(op.localChanges?.paths).not.toContain('other/draft.md');
}, 60_000);
