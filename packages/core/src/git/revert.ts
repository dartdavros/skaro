import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, GitError } from './command.ts';
import type { GitService } from './git.ts';
import { serializedMerge } from './merge-queue.ts';
import { captureFiles, publishMerge } from './merge-publication.ts';

export interface RevertOptions {
  /** Rebase merges require reverting every commit published since this exact base head. */
  before?: string;
  managedPaths?: string[];
  beforeCommit?: (checkout: string) => Promise<string[]>;
}

export function revert(
  service: GitService,
  commit: string,
  message?: string,
  options: RevertOptions = {},
) {
  return serializedMerge(service.repo, async () => {
    if (!(await service.isClean())) throw new Error('working copy has uncommitted changes');
    const base = await service.currentBranch();
    if (!base) throw new Error('Cannot revert a task merge on a detached HEAD');
    const gitDir = (await git(service.repo, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
    if ((await readdir(gitDir)).some((name) => name.startsWith('skaro-merge-recovery-')))
      throw new Error('Previous merge requires recovery before reverting');
    const before = await service.head();
    const managed = await captureFiles(service.repo, options.managedPaths ?? []);
    const dir = await mkdtemp(join(tmpdir(), 'skaro-revert-'));
    const checkout = join(dir, 'checkout');
    let registered = false;
    try {
      await git(service.repo, ['worktree', 'add', '--detach', checkout, before]);
      registered = true;
      let commits = [commit];
      if (options.before) {
        await git(service.repo, ['merge-base', '--is-ancestor', options.before, commit]);
        commits = (await git(service.repo, ['rev-list', `${options.before}..${commit}`])).stdout
          .trim()
          .split('\n')
          .filter(Boolean);
        if (!commits.length) throw new Error('No merge commits to revert');
      }
      for (const sha of commits) {
        const parents =
          (await git(checkout, ['rev-list', '--parents', '-n', '1', sha])).stdout.trim().split(' ')
            .length - 1;
        const args = ['revert', '--no-commit', ...(parents > 1 ? ['-m', '1'] : []), sha];
        const result = await git(checkout, args, { allowFail: true });
        if (result.code !== 0) {
          const conflicts = (await git(checkout, ['diff', '--name-only', '--diff-filter=U'])).stdout
            .split('\n')
            .filter(Boolean);
          if (conflicts.length) return { ok: false as const, conflicts };
          throw new GitError(args, result);
        }
      }
      const paths = (await options.beforeCommit?.(checkout)) ?? [];
      if (paths.some((path) => !(options.managedPaths ?? []).includes(path)))
        throw new Error('revert metadata must declare its managedPaths');
      if (paths.length) await git(checkout, ['add', '--', ...paths]);
      await git(checkout, [
        'commit',
        '--no-verify',
        ...(message ? ['-m', message] : ['--no-edit']),
      ]);
      const reverted = await service.head('HEAD', checkout);
      await publishMerge(service.repo, checkout, before, reverted, base, managed);
      return { ok: true as const, commit: reverted };
    } finally {
      if (registered) await git(service.repo, ['worktree', 'remove', '--force', checkout]);
      await rm(dir, { recursive: true, force: true });
    }
  });
}
