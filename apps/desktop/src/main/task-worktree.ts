import { git, GitService } from '@skaro/core';
import { existsSync } from 'node:fs';
import { mkdir, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** A retry reuses its checkout. It never deletes a previous run's runtime data. */
export async function prepareTaskWorktree(options: {
  git: GitService;
  dataDir: string;
  projectId: string;
  taskId: string;
  branch: string;
  base: string;
}): Promise<string> {
  const path = join(options.dataDir, 'worktrees', options.projectId, options.taskId);
  if (existsSync(path)) {
    // --show-toplevel rejects arbitrary folders; branch identity rejects another checkout.
    const branch = await options.git.currentBranch(path);
    const root = (await git(path, ['rev-parse', '--show-toplevel'])).stdout.trim();
    const common = resolve(
      path,
      (await git(path, ['rev-parse', '--git-common-dir'])).stdout.trim(),
    );
    const expected = resolve(
      options.git.repo,
      (await git(options.git.repo, ['rev-parse', '--git-common-dir'])).stdout.trim(),
    );
    const [actualRoot, targetRoot, actualCommon, expectedCommon] = await Promise.all(
      [root, path, common, expected].map((entry) => realpath(entry)),
    );
    if (actualRoot !== targetRoot || actualCommon !== expectedCommon || branch !== options.branch) {
      throw new Error(
        `Existing worktree retained at ${path}; its repository or branch does not match this task`,
      );
    }
    return path;
  }
  await mkdir(dirname(path), { recursive: true });
  await options.git.createWorktree({ path, branch: options.branch, base: options.base });
  return path;
}
