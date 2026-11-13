import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { git } from './command.ts';
import { GitSnapshot } from './snapshot.ts';

const exact = { env: { GIT_NO_REPLACE_OBJECTS: '1' } };
it('reads exact immutable files, sizes and literal commit diffs without changing real worktrees', async () => {
  const root = (await git(process.cwd(), ['rev-parse', '--show-toplevel'])).stdout.trim();
  const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const before = await git(root, ['worktree', 'list', '--porcelain']);
  const snapshot = new GitSnapshot(resolve(root), head);
  const files = await snapshot.files();
  expect(files).toContain('package.json');
  const bytes = await snapshot.read('package.json');
  expect(Buffer.isBuffer(bytes)).toBe(true);
  expect(bytes.length).toBe(
    Number((await git(root, ['cat-file', '-s', `${head}:package.json`], exact)).stdout),
  );
  expect(bytes.toString('utf8')).toBe(
    (await git(root, ['show', `${head}:package.json`], exact)).stdout,
  );
  const parent = (await git(root, ['rev-parse', 'HEAD^'], exact)).stdout.trim();
  expect(await snapshot.diff('package.json')).toBe(
    (
      await git(
        root,
        [
          '--literal-pathspecs',
          'diff-tree',
          '--no-commit-id',
          '--no-ext-diff',
          '--no-textconv',
          '--no-color',
          '-p',
          parent,
          head,
          '--',
          'package.json',
        ],
        exact,
      )
    ).stdout,
  );
  await expect(snapshot.read('../package.json')).rejects.toThrow('not available');
  await expect(snapshot.diff('../package.json')).rejects.toThrow('Invalid historical path');
  expect(await snapshot.diff(':(glob)**')).toBe('');
  expect((await git(root, ['worktree', 'list', '--porcelain'])).stdout).toBe(before.stdout);
});

it('defines a real merge commit diff against its explicit first parent, not an implicit empty merge diff', async () => {
  const root = (await git(process.cwd(), ['rev-parse', '--show-toplevel'])).stdout.trim();
  const merge = (await git(root, ['rev-list', '--merges', '-n', '1', 'HEAD'], exact)).stdout.trim();
  // This test only reads existing history; never synthesizes a merge or a repository.
  if (!merge) return;
  const paths = (
    await git(root, ['diff-tree', '-r', '--name-only', `${merge}^1`, merge], exact)
  ).stdout
    .trim()
    .split('\n');
  const path = paths.find(Boolean);
  if (!path) return; // An actual empty merge has no changed path to inspect.
  const expected = (
    await git(
      root,
      [
        '--literal-pathspecs',
        'diff-tree',
        '--no-commit-id',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        '-p',
        `${merge}^1`,
        merge,
        '--',
        path,
      ],
      exact,
    )
  ).stdout;
  expect(await new GitSnapshot(root, merge).diff(path)).toBe(expected);
});

it('fails closed for symbolic, malformed and unavailable object identities', async () => {
  for (const commit of ['HEAD', 'a'.repeat(41), 'a'.repeat(63)])
    expect(() => new GitSnapshot(process.cwd(), commit)).toThrow('exact commit');
  await expect(new GitSnapshot(process.cwd(), '0'.repeat(40)).verify()).rejects.toThrow();
});
