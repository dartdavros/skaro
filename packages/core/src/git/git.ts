// Git operations Skaro performs (docs/architecture.md, sections 7–8): a worktree and branch
// per task, merge checks, squash or merge, revert. Uses the system git (2.38+ for merge-tree).

import { existsSync } from 'node:fs';
import { SKARO_DIR } from '../artifacts/store.ts';
import { git, GitError } from './command.ts';
import { assertRemovableWorktree, type ContainerMounts } from './worktree-safety.ts';
import * as state from './worktree-state.ts';
import { diffStats, worktreeStats } from './diff.ts';
import { merge } from './merge.ts';
import { revert, type RevertOptions } from './revert.ts';
import { localMergeObstacles } from './merge-safety.ts';
export { git, GitError, type GitResult } from './command.ts';
export { WorktreeRemovalBlocked } from './worktree-safety.ts';

/** Hard reasons a merge cannot happen now. */
export type MergeBlocker = 'dirty_base' | 'not_on_base' | 'conflicts' | 'no_changes';

export interface MergeCheck {
  blockers: MergeBlocker[];
  /** Local paths that would be overwritten, rather than unrelated dirty files. */
  localChanges?: string[];
  /** Commits on the base branch the task branch does not have ("Обновить ветку задачи"). */
  baseAhead: number;
  /** Files the trial merge could not merge. */
  conflicts: string[];
  /** Changes to .skaro/ in the task branch; dropped on merge (D-17). */
  skaroChanges: string[];
  stats: DiffStats;
}

export interface DiffStats {
  files: number;
  added: number;
  removed: number;
}

export interface MergeOptions {
  base: string;
  branch: string;
  strategy: 'squash' | 'merge' | 'rebase';
  message: string;
  /** The task worktree: "rebase" moves the branch onto the base there first. */
  worktree?: string;
  /** Metadata paths Skaro is allowed to update; checked before publishing. */
  managedPaths?: string[];
  /** Runs only in the isolated merge checkout, never in the user's working copy. */
  beforeCommit?: (checkout: string) => Promise<string[]>;
  /** Checks the prepared candidate after metadata is staged and before publication. */
  verify?: (checkout: string) => Promise<void>;
}

export class MergeBlockedError extends Error {
  readonly check: MergeCheck;

  constructor(check: MergeCheck) {
    super(`merge blocked: ${check.blockers.join(', ')}`);
    this.check = check;
  }
}

export class GitService {
  /** Main working copy of the project. */
  readonly repo: string;

  constructor(
    repo: string,
    privateOptions: { inspectMounts?: () => Promise<ContainerMounts[]> } = {},
  ) {
    this.repo = repo;
    this.inspectMounts = privateOptions.inspectMounts;
  }

  private readonly inspectMounts: (() => Promise<ContainerMounts[]>) | undefined;

  async version(): Promise<[number, number]> {
    const out = (await git(this.repo, ['--version'])).stdout;
    const [, major, minor] = /(\d+)\.(\d+)/.exec(out) ?? [];
    return [Number(major), Number(minor)];
  }

  async currentBranch(cwd = this.repo): Promise<string | undefined> {
    const { stdout, code } = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      allowFail: true,
    });
    return code === 0 ? stdout.trim() : undefined;
  }

  /** No uncommitted changes to tracked files. Untracked files do not block a merge. */
  async isClean(cwd = this.repo): Promise<boolean> {
    return (await git(cwd, ['status', '--porcelain', '--untracked-files=no'])).stdout.trim() === '';
  }

  async branchExists(branch: string): Promise<boolean> {
    return (
      (
        await git(this.repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
          allowFail: true,
        })
      ).code === 0
    );
  }

  async head(ref = 'HEAD', cwd = this.repo): Promise<string> {
    return (await git(cwd, ['rev-parse', ref])).stdout.trim();
  }

  // ── worktrees ────────────────────────────────────────────────────────────

  /** Worktree for a task: reuses the branch if it exists, otherwise branches from `base`. */
  async createWorktree(options: { path: string; branch: string; base: string }): Promise<void> {
    if (await this.branchExists(options.branch)) {
      await git(this.repo, ['worktree', 'add', options.path, options.branch]);
    } else {
      await git(this.repo, ['worktree', 'add', '-b', options.branch, options.path, options.base]);
    }
  }

  /** Preflight before ending any task sessions or removing task records. */
  async assertRemovableWorktree(path: string): Promise<void> {
    if (existsSync(path)) await assertRemovableWorktree(this.repo, path, this.inspectMounts);
  }

  /** Never force or swallow a failed removal: ignored data is not recoverable from Git. */
  async removeWorktree(path: string, options: { deleteBranch?: string } = {}): Promise<void> {
    await this.assertRemovableWorktree(path);
    if (existsSync(path)) await git(this.repo, ['worktree', 'remove', path]);
    await git(this.repo, ['worktree', 'prune']);
    if (options.deleteBranch) await this.deleteBranch(options.deleteBranch);
  }

  /** Deletes a local branch; a missing one is fine. */
  async deleteBranch(branch: string): Promise<void> {
    if (await this.branchExists(branch)) await git(this.repo, ['branch', '-D', branch]);
  }

  commitAll(worktree: string, message: string): Promise<boolean> {
    return state.commitAll(worktree, message);
  }
  diffStats(base: string, branch: string): Promise<DiffStats> {
    return diffStats(this.repo, base, branch);
  }
  worktreeStats(worktree: string, base: string): Promise<DiffStats> {
    return worktreeStats(worktree, base);
  }

  /** Checks shown in the merge confirmation card (docs/architecture.md, section 8). */
  async checkMerge(base: string, branch: string): Promise<MergeCheck> {
    const blockers: MergeBlocker[] = [];
    if ((await this.currentBranch()) !== base) blockers.push('not_on_base');

    const baseAhead = Number(
      (await git(this.repo, ['rev-list', '--count', `${branch}..${base}`])).stdout.trim(),
    );
    const skaroChanges = (
      await git(this.repo, ['diff', '--name-only', `${base}...${branch}`, '--', SKARO_DIR])
    ).stdout
      .split('\n')
      .filter(Boolean);
    const stats = await this.diffStats(base, branch);
    const codeFiles = stats.files - skaroChanges.length;
    if (codeFiles <= 0) blockers.push('no_changes');

    const trial = await git(
      this.repo,
      ['merge-tree', '--write-tree', '--name-only', '--no-messages', base, branch],
      {
        allowFail: true,
      },
    );
    let conflicts: string[] = [];
    if (trial.code === 1) {
      conflicts = trial.stdout.split('\n').slice(1).filter(Boolean);
      blockers.push('conflicts');
    } else if (trial.code !== 0) {
      throw new GitError(['merge-tree', base, branch], trial);
    }
    const localChanges =
      trial.code === 0
        ? await localMergeObstacles(this.repo, base, trial.stdout.split('\n')[0]!, skaroChanges)
        : [];
    if (localChanges.length) blockers.push('dirty_base');
    return {
      blockers,
      baseAhead,
      conflicts,
      skaroChanges,
      stats,
      ...(localChanges.length ? { localChanges } : {}),
    };
  }

  /** Merge implementation stays separate from worktree lifecycle and checks. */
  merge(options: MergeOptions): Promise<{ commit: string; check: MergeCheck; before: string }> {
    return merge(this, options);
  }

  /** Brings the task branch up to date with the base ("Обновить ветку задачи"). */
  async rebase(
    worktree: string,
    base: string,
  ): Promise<{ ok: true } | { ok: false; conflicts: string[] }> {
    const result = await git(worktree, ['rebase', base], { allowFail: true });
    if (result.code === 0) return { ok: true };
    const conflicts = (
      await git(worktree, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true })
    ).stdout
      .split('\n')
      .filter(Boolean);
    await git(worktree, ['rebase', '--abort'], { allowFail: true });
    return { ok: false, conflicts };
  }

  /** Undoes a merge with a new commit ("Отменить слияние"). */
  revert(
    commit: string,
    message?: string,
    options?: RevertOptions,
  ): Promise<{ ok: true; commit: string } | { ok: false; conflicts: string[] }> {
    return revert(this, commit, message, options);
  }
}
