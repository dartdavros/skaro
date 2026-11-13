import { expect, it } from 'vitest';
import { git } from './command.ts';
import { assertExpectedCheckout, createWorktree } from './worktree-create.ts';

it('checks the real preserved branch and checkout against the exact expected commit without materializing anything', async () => {
  const root = (await git(process.cwd(), ['rev-parse', '--show-toplevel'])).stdout.trim();
  const branch = (await git(root, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim();
  const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const before = (await git(root, ['worktree', 'list', '--porcelain'])).stdout;
  await expect(
    assertExpectedCheckout(root, { branch, expectedCommit: head }, root),
  ).resolves.toBeUndefined();
  await expect(assertExpectedCheckout(root, { branch, expectedCommit: 'HEAD' })).rejects.toThrow(
    'exact expected commit',
  );
  const parent = (await git(root, ['rev-parse', 'HEAD^'])).stdout.trim();
  // The mismatch is rejected inside serialized creation, before any worktree/add or branch fallback.
  await expect(
    createWorktree(root, { branch, expectedCommit: parent, path: root, base: head }),
  ).rejects.toThrow('expected commit');
  await expect(
    assertExpectedCheckout(root, { branch: `refs/invalid-${head}`, expectedCommit: head }),
  ).rejects.toThrow();
  expect((await git(root, ['worktree', 'list', '--porcelain'])).stdout).toBe(before);
  expect((await git(root, ['rev-parse', `refs/heads/${branch}`])).stdout.trim()).toBe(head);
});
