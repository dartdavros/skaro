import { lstat, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { git } from '@skaro/core';
import { expect, it } from 'vitest';
import { assertHistoryDirectoryIdentity, HistoryPathGuard } from './history-path-guard';

it('revalidates actual repository ancestors and refuses unregistered or escaped directories without filesystem writes', async () => {
  const root = await realpath(
    (await git(process.cwd(), ['rev-parse', '--show-toplevel'])).stdout.trim(),
  );
  const before = (await git(root, ['worktree', 'list', '--porcelain'])).stdout;
  const guard = await HistoryPathGuard.capture(root);
  await expect(guard.leaf(join(root, 'package.json'))).resolves.toBeUndefined();
  await expect(guard.directory(join(root, 'packages'))).rejects.toThrow('was not registered');
  await guard.directory(join(root, 'packages'), true);
  await expect(guard.directory(join(root, 'packages'))).resolves.toBeUndefined();
  await expect(guard.directory(dirname(root))).rejects.toThrow('escaped its registered root');
  await expect(guard.leaf(join(dirname(root), 'package.json'))).rejects.toThrow(
    'escaped its registered root',
  );
  await expect(HistoryPathGuard.capture(join(root, 'package.json'))).rejects.toThrow(
    'not canonical',
  );
  expect((await git(root, ['worktree', 'list', '--porcelain'])).stdout).toBe(before);
});

it('rejects a replaced ancestor from exact bigint metadata even if its spelling and file contents match', async () => {
  const observed = await lstat(await realpath(process.cwd()), { bigint: true });
  expect(() => assertHistoryDirectoryIdentity(observed, observed)).not.toThrow();
  expect(() =>
    assertHistoryDirectoryIdentity(observed, { dev: observed.dev, ino: observed.ino + 1n }),
  ).toThrow('ancestor identity changed');
  expect(() =>
    assertHistoryDirectoryIdentity(observed, { dev: observed.dev + 1n, ino: observed.ino }),
  ).toThrow('ancestor identity changed');
});
