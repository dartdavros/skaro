import { assertCompletedTrackedContent } from './completed-worktree-diff.ts';
import {
  markResourceCleanupEffect,
  markResourceCleanupSettled,
} from '../resources/cleanup-context.ts';
import { lstat } from 'node:fs/promises';
import { git } from './command.ts';
import { serializedWorktree } from './merge-queue.ts';
import { assertRemovableWorktree, WorktreeRemovalBlocked } from './worktree-safety.ts';
import { clearWorktreeFiles } from './worktree-files.ts';
import { WorktreePathGuard } from './worktree-path-guard.ts';

export interface PreservedCheckout {
  branch: string;
  head: string;
  /** Caller supplies exact generation-bound proof of a previously verified cleanup checkpoint. */
  resuming?: boolean;
}

/** Caller proves all task owners are done and idle; checkpoint runs after the final clean proof. */
export async function removeCompletedWorktree(
  repo: string,
  path: string,
  preserve: PreservedCheckout,
  guard: () => void = () => undefined,
  checkpoint: () => void = () => undefined,
): Promise<void> {
  return serializedWorktree(repo, async () => {
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!stat) return;
    const scope = new WorktreePathGuard(path, guard);
    await scope.directory(path, true);
    const { branch, head } = preserve;
    const check = async () => {
      await scope.directory(path);
      await assertRemovableWorktree(repo, path, undefined, { completed: true });
      if (
        (await git(path, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim() !== branch ||
        (await git(path, ['rev-parse', 'HEAD'])).stdout.trim() !== head ||
        (await git(repo, ['rev-parse', `refs/heads/${branch}`])).stdout.trim() !== head
      )
        throw new WorktreeRemovalBlocked(
          path,
          'Checkout or preserved branch changed during cleanup',
        );
      await scope.directory(path);
    };
    await check();
    await assertCompletedTrackedContent(path, preserve.resuming === true);
    await check();
    guard();
    checkpoint();
    await clearWorktreeFiles(path, guard);
    await check();
    // Keep branch/commits/history. Fresh guards above precede Git's final exact unregister.
    guard();
    markResourceCleanupEffect(path, true);
    try {
      await git(repo, ['worktree', 'remove', '--force', path]);
    } finally {
      markResourceCleanupSettled(path);
    }
  });
}
