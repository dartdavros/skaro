import { git, GitService, type ResourceRecord } from '@skaro/core';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { admitWorktreePreparation } from './worktree-preparation-admission';
import {
  beginWorktreeResource,
  failWorktreeResource,
  finishWorktreeResource,
  type WorktreeRegistrationInput,
} from './task-worktree-resource';

/** A retry reuses its checkout. It never deletes a previous run's runtime data. */
export async function prepareTaskWorktree(
  options: WorktreeRegistrationInput & {
    git: GitService;
    dataDir: string;
    base: string;
    expectedCommit?: string;
  },
): Promise<string> {
  if (![options.projectId, options.taskId].every((id) => /^[a-z0-9][a-z0-9._-]*$/i.test(id)))
    throw new Error('Invalid managed worktree owner identity');
  return admitWorktreePreparation(
    options.resources,
    options.projectId,
    join(options.dataDir, 'worktrees', options.projectId, options.taskId),
    () => prepareAdmittedWorktree(options),
  );
}

async function prepareAdmittedWorktree(
  options: Parameters<typeof prepareTaskWorktree>[0],
): Promise<string> {
  const parent = await managedParent(options.dataDir, options.projectId);
  const path = join(parent, options.taskId);
  const present = await presentDirectory(path);
  const inspect = async () => {
    if (!(await presentDirectory(path))) throw new Error('Worktree disappeared during preparation');
    // --show-toplevel and the common Git directory reject arbitrary or foreign checkouts.
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
    if (
      actualRoot !== targetRoot ||
      !targetRoot ||
      resolve(targetRoot) !== resolve(path) ||
      actualCommon !== expectedCommon ||
      branch !== options.branch
    ) {
      throw new Error(
        `Existing worktree retained at ${path}; its repository or branch does not match this task`,
      );
    }
    const head = (await git(path, ['rev-parse', 'HEAD'])).stdout.trim();
    if (
      options.expectedCommit &&
      (head !== options.expectedCommit ||
        (
          await git(options.git.repo, ['rev-parse', '--verify', `refs/heads/${options.branch}`])
        ).stdout.trim() !== head)
    )
      throw new Error('The restored checkout does not match its expected commit');
    return head;
  };
  const head = present
    ? await inspect()
    : (
        await git(options.git.repo, ['rev-parse', '--verify', `${options.base}^{commit}`])
      ).stdout.trim();
  let resource: ResourceRecord | undefined;
  try {
    resource = beginWorktreeResource(options, path, present, head);
    if (!present)
      await options.git.createWorktree({
        path,
        branch: options.branch,
        base: head,
        expectedCommit: options.expectedCommit,
      });
    finishWorktreeResource(options, resource, await inspect(), !present);
    return path;
  } catch (error) {
    failWorktreeResource(options, resource);
    throw error;
  }
}

async function presentDirectory(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Existing worktree path is not a canonical directory');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Check each existing ancestor before creating the next directory; never follow a junction. */
async function managedParent(dataDir: string, projectId: string): Promise<string> {
  let path = await realpath(dataDir);
  for (const part of ['worktrees', projectId]) {
    path = join(path, part);
    if (!(await presentDirectory(path))) {
      try {
        await mkdir(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    if (!(await presentDirectory(path)) || resolve(await realpath(path)) !== resolve(path))
      throw new Error('Managed worktree parent is outside its canonical directory');
  }
  return path;
}
