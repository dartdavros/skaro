import {
  markResourceCleanupEffect,
  markResourceCleanupSettled,
} from '../resources/cleanup-context.ts';
import { realpath } from 'node:fs/promises';
import { git } from './command.ts';
import { serializedWorktree } from './merge-queue.ts';
import { assertRemovableWorktree, WorktreeRemovalBlocked } from './worktree-safety.ts';
import { clearWorktreeFiles } from './worktree-files.ts';
import { WorktreePathGuard } from './worktree-path-guard.ts';

export interface PreservedIntegrationCheckout {
  head: string;
  ref: string;
  /** Exact durable checkpoint of a previously started removal, not merely an idle operation. */
  resuming: boolean;
}

/** Caller owns the completed operation and ledger generation; the candidate commit survives. */
export function removeCompletedIntegrationWorktree(
  repo: string,
  path: string,
  preserve: PreservedIntegrationCheckout,
  guard: () => void,
  checkpoint: () => void,
): Promise<void> {
  return serializedWorktree(repo, async () => {
    const blocked = (reason: string): never => {
      throw new WorktreeRemovalBlocked(path, reason);
    };
    if (
      !/^refs\/skaro\/integrations\/[a-zA-Z0-9_-]+$/.test(preserve.ref) ||
      !/^[a-f0-9]{40,64}$/.test(preserve.head)
    )
      blocked('Invalid integration recovery reference');
    const scope = new WorktreePathGuard(path, guard);
    await scope.directory(path, true);
    const common = async (cwd: string) =>
      realpath(
        (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim(),
      );
    if ((await common(path)) !== (await common(repo))) blocked('Integration repository changed');
    const identity = async () => {
      const symbolic = await git(path, ['symbolic-ref', '--quiet', 'HEAD'], { allowFail: true });
      if (
        symbolic.code !== 1 ||
        (await git(path, ['rev-parse', 'HEAD'])).stdout.trim() !== preserve.head
      )
        blocked('Integration checkout or HEAD changed');
    };
    await identity();
    if (
      !preserve.resuming &&
      (await git(path, ['status', '--porcelain', '--untracked-files=all'])).stdout.trim()
    )
      blocked('Integration checkout contains unique changes');
    await scope.directory(path);
    const saved = await git(repo, ['rev-parse', '--verify', '--quiet', preserve.ref], {
      allowFail: true,
    });
    if (saved.code === 1) await git(repo, ['update-ref', preserve.ref, preserve.head, '']);
    else if (saved.code !== 0 || saved.stdout.trim() !== preserve.head)
      blocked('Integration recovery reference changed');
    const check = async () => {
      await scope.directory(path);
      await assertRemovableWorktree(repo, path, undefined, { completed: true });
      await identity();
      if ((await git(repo, ['rev-parse', preserve.ref])).stdout.trim() !== preserve.head)
        blocked('Integration recovery reference changed');
      await scope.directory(path);
    };
    await check();
    checkpoint();
    await clearWorktreeFiles(path, guard);
    await check();
    // Keep the operation, journal and recovery ref; remove only this Git registration.
    guard();
    markResourceCleanupEffect(path, true);
    try {
      await git(repo, ['worktree', 'remove', '--force', path]);
    } finally {
      markResourceCleanupSettled(path);
    }
  });
}
