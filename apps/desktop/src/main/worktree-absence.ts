import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { git } from '@skaro/core';

/** Permission errors and a stale Git registration are not successful deletion. */
export async function worktreeAbsent(root: string, path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return !(await git(root, ['worktree', 'list', '--porcelain', '-z'])).stdout
    .split('\0')
    .some((line) => line.startsWith('worktree ') && resolve(line.slice(9)) === resolve(path));
}
