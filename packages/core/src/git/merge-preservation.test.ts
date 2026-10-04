import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { git, GitService } from './git.ts';
import { repo, service, write, commit, taskWithChange, log } from './git-test-support.ts';

const options = (branch = 'skaro/T-001-a') => ({
  base: 'main',
  branch,
  strategy: 'squash' as const,
  message: 'merge task',
});
const diff = async (staged = false) =>
  (await git(repo, ['diff', ...(staged ? ['--cached'] : []), '--binary'])).stdout;

it('preserves separate staged and unstaged edits when two independent tasks merge concurrently', async () => {
  await taskWithChange({ 'one.txt': 'one\n' });
  await taskWithChange({ 'two.txt': 'two\n' }, 'skaro/T-002-b');
  await write(repo, 'README.md', '# staged\n');
  await git(repo, ['add', 'README.md']);
  await write(repo, 'README.md', '# unstaged on staged\n');
  await write(repo, 'scratch.txt', 'untracked\n');
  const staged = await diff(true);
  const unstaged = await diff();
  expect((await service.checkMerge('main', 'skaro/T-001-a')).blockers).toEqual([]);
  await Promise.all([
    service.merge(options()),
    new GitService(repo).merge(options('skaro/T-002-b')),
  ]);
  expect(await diff(true)).toBe(staged);
  expect(await diff()).toBe(unstaged);
  expect(await readFile(join(repo, 'scratch.txt'), 'utf8')).toBe('untracked\n');
  expect(await readFile(join(repo, 'one.txt'), 'utf8')).toBe('one\n');
  expect(await readFile(join(repo, 'two.txt'), 'utf8')).toBe('two\n');
  expect((await git(repo, ['show', 'HEAD:README.md'])).stdout).toBe('# calc\n');
}, 15_000); // Two real Git publication workflows run serially inside the repository queue.

it('detects staged changes even when the working file has been changed back to HEAD', async () => {
  await taskWithChange({ 'README.md': '# task\n' });
  await write(repo, 'README.md', '# staged\n');
  await git(repo, ['add', 'README.md']);
  await write(repo, 'README.md', '# calc\n');
  const check = await service.checkMerge('main', 'skaro/T-001-a');
  expect(check.blockers).toEqual(['dirty_base']);
  expect(check.localChanges).toEqual(['README.md']);
});

it('protects ignored data and untracked paths that the task would replace', async () => {
  await commit(repo, 'ignore runtime', { '.gitignore': 'data/\n' });
  const worktree = await taskWithChange({ 'feature.txt': 'feature\n' });
  await write(worktree, 'data/db', 'tracked by task\n');
  await git(worktree, ['add', '-f', 'data/db']);
  await git(worktree, ['commit', '-qm', 'add data']);
  await write(repo, 'data/db', 'real runtime data\n');
  await write(repo, 'feature.txt', 'local new file\n');
  expect((await service.checkMerge('main', 'skaro/T-001-a')).localChanges).toEqual([
    'data/db',
    'feature.txt',
  ]);
  await expect(service.merge(options())).rejects.toThrow('dirty_base');
  expect(await readFile(join(repo, 'data/db'), 'utf8')).toBe('real runtime data\n');
});

it('prepares metadata away from the working copy and leaves it untouched on preparation failure', async () => {
  await taskWithChange({ 'feature.txt': 'feature\n' });
  const path = '.skaro/tasks/T-001-a.md';
  const original = await readFile(join(repo, path), 'utf8');
  await write(repo, 'README.md', '# staged\n');
  await git(repo, ['add', 'README.md']);
  const staged = await diff(true);
  await expect(
    service.merge({
      ...options(),
      managedPaths: [path],
      beforeCommit: async (checkout) => {
        await write(checkout, path, 'candidate metadata\n');
        throw new Error('metadata failure');
      },
    }),
  ).rejects.toThrow('metadata failure');
  expect(await readFile(join(repo, path), 'utf8')).toBe(original);
  expect(await diff(true)).toBe(staged);
  expect(await log(repo)).toEqual(['init']);
});

it('restores only published files when publishing the branch fails, keeping staging intact', async () => {
  await taskWithChange({ 'feature.txt': 'feature\n' });
  const path = '.skaro/tasks/T-001-a.md';
  const original = await readFile(join(repo, path), 'utf8');
  await write(repo, 'README.md', '# staged\n');
  await git(repo, ['add', 'README.md']);
  const staged = await diff(true);
  await expect(
    service.merge({
      ...options(),
      managedPaths: [path],
      beforeCommit: async (checkout) => {
        await write(checkout, path, 'candidate metadata\n');
        await write(repo, '.git/refs/heads/main.lock', 'external Git lock');
        return [path];
      },
    }),
  ).rejects.toThrow('update-ref');
  expect(await readFile(join(repo, path), 'utf8')).toBe(original);
  expect(await diff(true)).toBe(staged);
  expect(await log(repo)).toEqual(['init']);
  expect(
    (await readdir(join(repo, '.git'))).filter((name) => name.startsWith('skaro-merge-recovery-')),
  ).toEqual([]);
});

it('rejects a concurrent edit to managed metadata without overwriting it', async () => {
  await taskWithChange({ 'feature.txt': 'feature\n' });
  const path = '.skaro/tasks/T-001-a.md';
  await expect(
    service.merge({
      ...options(),
      managedPaths: [path],
      beforeCommit: async (checkout) => {
        await write(checkout, path, 'candidate\n');
        await write(repo, path, 'new user edit\n');
        return [path];
      },
    }),
  ).rejects.toThrow('metadata changed');
  expect(await readFile(join(repo, path), 'utf8')).toBe('new user edit\n');
  expect(await log(repo)).toEqual(['init']);
});

it.each(['merge', 'rebase'] as const)(
  'preserves unrelated staging with the %s strategy',
  async (strategy) => {
    const worktree = await taskWithChange({ 'feature.txt': 'feature\n' });
    await write(repo, 'README.md', '# staged\n');
    await git(repo, ['add', 'README.md']);
    await write(repo, 'README.md', '# unstaged\n');
    const staged = await diff(true);
    const unstaged = await diff();
    const result = await service.merge({ ...options(), strategy, worktree });
    expect(await service.head()).toBe(result.commit);
    expect(await diff(true)).toBe(staged);
    expect(await diff()).toBe(unstaged);
    expect((await git(repo, ['show', 'HEAD:README.md'])).stdout).toBe('# calc\n');
  },
);
