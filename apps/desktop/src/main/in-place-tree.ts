import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';

/** Include the owner's untracked sources without touching the actual index or HEAD. */
export async function matchesInPlaceTree(root: string, head: string) {
  const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
  const directory = await mkdtemp(join(gitDir, 'skaro-verify-tree-'));
  const index = join(directory, 'index');
  const env = { GIT_INDEX_FILE: index };
  try {
    await git(root, ['read-tree', head], { env });
    await git(root, ['add', '-A', '--', '.', ':(exclude).skaro'], { env });
    const diff = await git(root, ['diff', '--cached', '--quiet', head], { env, allowFail: true });
    if (diff.code > 1) throw new Error(diff.stderr || 'Cannot compare the accepted source tree');
    return diff.code === 0;
  } finally {
    await rm(index, { force: true });
    await rm(index + '.lock', { force: true });
    await rmdir(directory);
  }
}
