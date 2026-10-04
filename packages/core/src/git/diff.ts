import { git } from './command.ts';
import type { DiffStats } from './git.ts';

export async function diffStats(repo: string, base: string, branch: string): Promise<DiffStats> {
  const out = (await git(repo, ['diff', '--numstat', `${base}...${branch}`])).stdout;
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

/**
 * What a task changed so far in its worktree: commits since it left the base branch plus
 * uncommitted edits; new untracked files count as files.
 */
export async function worktreeStats(worktree: string, base: string): Promise<DiffStats> {
  const from = (await git(worktree, ['merge-base', base, 'HEAD'])).stdout.trim();
  const out = (await git(worktree, ['diff', '--numstat', from])).stdout;
  const untracked = (await git(worktree, ['ls-files', '--others', '--exclude-standard'])).stdout
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('.skaro/')).length;
  let files = untracked;
  let added = 0;
  let removed = 0;
  for (const line of out.split('\n')) {
    const [a, r, path] = line.split('\t');
    if (a === undefined || r === undefined || path?.startsWith('.skaro/')) continue;
    files++;
    added += Number(a) || 0;
    removed += Number(r) || 0;
  }
  return { files, added, removed };
}
