import { SKARO_DIR } from '../artifacts/store.ts';
import { git, GitError } from './command.ts';
import type { GitService, MergeBlocker, MergeCheck } from './git.ts';
import { isBaseCheckedOut } from './merge-base-worktree.ts';
import { localMergeObstacles } from './merge-safety.ts';

export async function checkMerge(
  service: GitService,
  base: string,
  branch: string,
  publishOffCheckout: boolean,
): Promise<MergeCheck> {
  const { repo } = service;
  const blockers: MergeBlocker[] = [];
  const onBase = (await service.currentBranch()) === base;
  const isolatedBase = !onBase && publishOffCheckout && !(await isBaseCheckedOut(repo, base));
  if (!onBase && !isolatedBase) blockers.push('not_on_base');

  const baseAhead = Number(
    (await git(repo, ['rev-list', '--count', `${branch}..${base}`])).stdout.trim(),
  );
  const skaroChanges = (
    await git(repo, ['diff', '--name-only', `${base}...${branch}`, '--', SKARO_DIR])
  ).stdout
    .split('\n')
    .filter(Boolean);
  const stats = await service.diffStats(base, branch);
  if (stats.files <= skaroChanges.length) blockers.push('no_changes');

  const trialArgs = ['merge-tree', '--write-tree', '--name-only', '--no-messages', base, branch];
  const trial = await git(repo, trialArgs, { allowFail: true });
  let conflicts: string[] = [];
  if (trial.code === 1) {
    conflicts = trial.stdout.split('\n').slice(1).filter(Boolean);
    blockers.push('conflicts');
  } else if (trial.code !== 0) {
    throw new GitError(trialArgs, trial);
  }
  const localChanges =
    trial.code === 0 && !isolatedBase
      ? await localMergeObstacles(repo, base, trial.stdout.split('\n')[0]!, skaroChanges)
      : [];
  if (localChanges.length) blockers.push('dirty_base');
  return {
    blockers,
    ...(isolatedBase && { isolatedBase }),
    baseAhead,
    conflicts,
    skaroChanges,
    stats,
    ...(localChanges.length ? { localChanges } : {}),
  };
}
