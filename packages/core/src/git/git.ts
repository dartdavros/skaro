// Git operations Skaro performs (docs/architecture.md, sections 7–8): a worktree and branch
// per task, merge checks, squash or merge, revert. Uses the system git (2.38+ for merge-tree).

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SKARO_DIR } from '../artifacts/store.ts';

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class GitError extends Error {
  readonly args: string[];
  readonly code: number;
  readonly stderr: string;

  constructor(args: string[], result: GitResult) {
    super(
      `git ${args.join(' ')} failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
    this.args = args;
    this.code = result.code;
    this.stderr = result.stderr;
  }
}

/** Runs git in `cwd`. Non-zero exit throws unless `allowFail` is set. */
export function git(
  cwd: string,
  args: string[],
  options: { allowFail?: boolean } = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        const result = { stdout: String(stdout), stderr: String(stderr), code };
        if (code !== 0 && !options.allowFail) reject(new GitError(args, result));
        else resolve(result);
      },
    );
  });
}

/** Hard reasons a merge cannot happen now. */
export type MergeBlocker = 'dirty_base' | 'not_on_base' | 'conflicts' | 'no_changes';

export interface MergeCheck {
  blockers: MergeBlocker[];
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
  strategy: 'squash' | 'merge';
  message: string;
  /** Called in the main working copy before the commit; returns paths to add to it (e.g. the task file). */
  beforeCommit?: () => Promise<string[]>;
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

  constructor(repo: string) {
    this.repo = repo;
  }

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

  /** Removes a task worktree (and its branch, if asked). Missing worktrees are fine. */
  async removeWorktree(path: string, options: { deleteBranch?: string } = {}): Promise<void> {
    await git(this.repo, ['worktree', 'remove', '--force', path], { allowFail: true });
    await git(this.repo, ['worktree', 'prune']);
    if (options.deleteBranch && (await this.branchExists(options.deleteBranch))) {
      await git(this.repo, ['branch', '-D', options.deleteBranch]);
    }
  }

  /**
   * Commits everything left in a task worktree, untracked files included, so the branch holds
   * all of the agent's work before a merge. Returns false when there was nothing to commit.
   */
  async commitAll(worktree: string, message: string): Promise<boolean> {
    await git(worktree, ['add', '-A']);
    if ((await git(worktree, ['diff', '--cached', '--quiet'], { allowFail: true })).code === 0) {
      return false;
    }
    await git(worktree, ['commit', '--no-verify', '-q', '-m', message]);
    return true;
  }

  // ── merge ────────────────────────────────────────────────────────────────

  async diffStats(base: string, branch: string): Promise<DiffStats> {
    const out = (await git(this.repo, ['diff', '--numstat', `${base}...${branch}`])).stdout;
    let files = 0;
    let added = 0;
    let removed = 0;
    for (const line of out.split('\n')) {
      const [a, r] = line.split('\t');
      if (a === undefined || r === undefined) continue;
      files++;
      added += Number(a) || 0; // binary files show "-"
      removed += Number(r) || 0;
    }
    return { files, added, removed };
  }

  /** Checks shown in the merge confirmation card (docs/architecture.md, section 8). */
  async checkMerge(base: string, branch: string): Promise<MergeCheck> {
    const blockers: MergeBlocker[] = [];
    // Skaro keeps task statuses in .skaro/ uncommitted until the merge; they do not block it.
    const dirty = (
      await git(this.repo, [
        'status',
        '--porcelain',
        '--untracked-files=no',
        '--',
        '.',
        `:(exclude)${SKARO_DIR}`,
      ])
    ).stdout.trim();
    if (dirty) blockers.push('dirty_base');
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
    return { blockers, baseAhead, conflicts, skaroChanges, stats };
  }

  /**
   * Merges the task branch into the checked-out base. Changes to .skaro/ from the branch are
   * dropped (D-17). On any failure the working copy is restored to where it was.
   * Returns the new commit.
   */
  async merge(options: MergeOptions): Promise<{ commit: string; check: MergeCheck }> {
    const check = await this.checkMerge(options.base, options.branch);
    if (check.blockers.length) throw new MergeBlockedError(check);

    const before = await this.head();
    const pending = await this.pendingSkaroFiles();
    try {
      if (options.strategy === 'squash') {
        await git(this.repo, ['merge', '--squash', '--no-commit', options.branch]);
      } else {
        await git(this.repo, ['merge', '--no-ff', '--no-commit', options.branch]);
      }
      if (check.skaroChanges.length) {
        await git(this.repo, [
          'restore',
          '--source=HEAD',
          '--staged',
          '--worktree',
          '--',
          ...check.skaroChanges,
        ]);
      }
      const extra = (await options.beforeCommit?.()) ?? [];
      if (extra.length) await git(this.repo, ['add', '--', ...extra]);
      await git(this.repo, ['commit', '--no-verify', '-m', options.message]);
      return { commit: await this.head(), check };
    } catch (error) {
      await this.restore(before);
      // The reset also dropped Skaro's uncommitted .skaro/ edits: put them back.
      for (const [path, content] of pending) await writeFile(join(this.repo, path), content);
      throw error;
    }
  }

  /** Uncommitted edits of tracked .skaro/ files in the main working copy, by path. */
  private async pendingSkaroFiles(): Promise<Map<string, Buffer>> {
    const out = (await git(this.repo, ['diff', '--name-only', 'HEAD', '--', SKARO_DIR])).stdout;
    const files = new Map<string, Buffer>();
    for (const path of out.split('\n').filter(Boolean)) {
      try {
        files.set(path, await readFile(join(this.repo, path)));
      } catch {
        // deleted locally: nothing to put back
      }
    }
    return files;
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
  async revert(
    commit: string,
    message?: string,
  ): Promise<{ ok: true; commit: string } | { ok: false; conflicts: string[] }> {
    if (!(await this.isClean())) throw new Error('working copy has uncommitted changes');
    const parents =
      (await git(this.repo, ['rev-list', '--parents', '-n', '1', commit])).stdout.trim().split(' ')
        .length - 1;
    const args = ['revert', '--no-edit', ...(parents > 1 ? ['-m', '1'] : []), commit];
    const result = await git(this.repo, args, { allowFail: true });
    if (result.code !== 0) {
      const conflicts = (
        await git(this.repo, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true })
      ).stdout
        .split('\n')
        .filter(Boolean);
      await git(this.repo, ['revert', '--abort'], { allowFail: true });
      if (!conflicts.length) throw new GitError(args, result);
      return { ok: false, conflicts };
    }
    if (message) await git(this.repo, ['commit', '--amend', '--no-verify', '-m', message]);
    return { ok: true, commit: await this.head() };
  }

  /** Back to `commit` after a failed merge. Safe: the working copy was clean before. */
  private async restore(commit: string): Promise<void> {
    await git(this.repo, ['merge', '--abort'], { allowFail: true });
    await git(this.repo, ['reset', '--hard', commit]);
  }
}
