import { access } from 'node:fs/promises';
import { git } from '@skaro/core';

const operations = [
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'rebase-apply',
  'rebase-merge',
  'sequencer',
  'index.lock',
];

export const stoppedCheckoutOwner = (projectId: string) => `task.stopped-main-owner.${projectId}`;

/** Skaro's own task metadata does not belong to the agent's code changes. */
export async function mainCheckoutClean(root: string): Promise<boolean> {
  try {
    const state = await git(root, [
      '--no-optional-locks',
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      '.',
      ':(exclude).skaro',
    ]);
    if (state.stdout.trim()) return false;
    const paths = await git(root, [
      'rev-parse',
      '--path-format=absolute',
      ...operations.flatMap((name) => ['--git-path', name]),
    ]);
    if (paths.stdout.trim().split(/\r?\n/).length !== operations.length) return false;
    const pending = await Promise.all(
      paths.stdout
        .trim()
        .split(/\r?\n/)
        .map(async (path) => {
          try {
            await access(path);
            return true;
          } catch (error) {
            return (error as NodeJS.ErrnoException).code !== 'ENOENT';
          }
        }),
    );
    return !pending.includes(true);
  } catch {
    // An unreadable source checkout is not safe to hand to a different task.
    return false;
  }
}
