import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from './command.ts';
import {
  GitBaseChangedError,
  MergeBlockedError,
  type GitService,
  type MergeOptions,
  type MergeCheck,
} from './git.ts';
import { serializedMerge } from './merge-queue.ts';
import { localMergeObstacles } from './merge-safety.ts';
import { captureFiles, publishMerge } from './merge-publication.ts';
import { recoverPublications } from './merge-recovery.ts';
import { assertLocalChanges, LocalChangesChangedError } from './local-changes.ts';

export function merge(
  service: GitService,
  options: MergeOptions,
): Promise<{ commit: string; check: MergeCheck; before: string }> {
  return serializedMerge(service.repo, () => prepareMerge(service, options));
}

async function prepareMerge(service: GitService, options: MergeOptions) {
  await recoverPublications(service.repo);
  if (options.expectedBaseHead && (await service.head(options.base)) !== options.expectedBaseHead)
    throw new GitBaseChangedError();
  const check = await service.checkMerge(options.base, options.branch);
  if (options.localResolution) {
    await assertLocalChanges(service.repo, options.localResolution.snapshot);
    if (check.localChanges?.some((path) => !options.localResolution!.snapshot.paths.includes(path)))
      throw new LocalChangesChangedError();
    check.blockers = check.blockers.filter((blocker) => blocker !== 'dirty_base');
  }
  if (options.allowMetadataOnly && options.managedPaths?.length)
    check.blockers = check.blockers.filter((blocker) => blocker !== 'no_changes');
  if (check.blockers.length) throw new MergeBlockedError(check);
  const before = await service.head();
  const managed = await captureFiles(service.repo, options.managedPaths ?? []);
  const guards = await captureFiles(service.repo, options.guardPaths ?? []);
  const dir = await mkdtemp(join(tmpdir(), 'skaro-merge-'));
  const checkout = join(dir, 'checkout');
  let registered = false;
  try {
    await service.createDetachedWorktree(checkout, before);
    registered = true;
    if (options.strategy === 'rebase') {
      if (options.expectedBaseHead) {
        // Replay the resolved tree onto the base, without replaying conflicting source commits.
        await git(checkout, ['read-tree', '--reset', '-u', options.branch]);
      } else {
        if (!options.worktree) throw new Error('a rebase merge needs the task worktree');
        const rebased = await service.rebase(options.worktree, options.base);
        if (!rebased.ok)
          throw new MergeBlockedError({
            ...check,
            blockers: ['conflicts'],
            conflicts: rebased.conflicts,
          });
        await git(checkout, ['merge', '--ff-only', await service.head('HEAD', options.worktree)]);
      }
    } else {
      await git(checkout, [
        'merge',
        ...(options.strategy === 'squash' ? ['--squash'] : ['--no-ff']),
        '--no-commit',
        options.branch,
      ]);
    }
    if (check.skaroChanges.length)
      await git(checkout, [
        'restore',
        `--source=${before}`,
        '--staged',
        '--worktree',
        '--',
        ...check.skaroChanges,
      ]);
    const extra = (await options.beforeCommit?.(checkout)) ?? [];
    if (extra.some((path) => !(options.managedPaths ?? []).includes(path)))
      throw new Error('merge metadata must declare its managedPaths');
    if (extra.length) await git(checkout, ['add', '--', ...extra]);
    if (options.verify) {
      const tree = (await git(checkout, ['write-tree'])).stdout;
      await options.verify(checkout);
      const changed = await git(checkout, ['diff', '--quiet'], { allowFail: true });
      if (changed.code !== 0 || (await git(checkout, ['write-tree'])).stdout !== tree)
        throw new Error('Verification changed tracked files or the merge index');
    }
    const staged = await git(checkout, ['diff', '--cached', '--quiet'], { allowFail: true });
    if (options.strategy !== 'rebase' || staged.code !== 0)
      await git(checkout, ['commit', '--no-verify', '-m', options.message]);
    const commit = await service.head('HEAD', checkout);
    const obstacles = await localMergeObstacles(service.repo, before, commit, extra);
    if (obstacles.some((path) => !options.localResolution?.snapshot.paths.includes(path)))
      throw new MergeBlockedError({ ...check, blockers: ['dirty_base'], localChanges: obstacles });
    await options.prepared?.({ before, commit });
    if ((await service.head(options.base)) !== before) throw new GitBaseChangedError();
    await publishMerge(
      service.repo,
      checkout,
      before,
      commit,
      options.base,
      managed,
      guards,
      options.localResolution,
    );
    return { commit, check, before };
  } finally {
    // This is Skaro's private checkout: no services or ignored user data run here.
    if (registered) await service.removeDetachedWorktree(checkout);
    await rm(dir, { recursive: true, force: true });
  }
}
