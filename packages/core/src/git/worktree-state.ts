import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from './command.ts';

export interface WorktreeSnapshot {
  head: string;
  tree: string;
}

/** Uses a separate Git index; ignored runtime data never enters Git. */
export async function snapshot(worktree: string): Promise<WorktreeSnapshot> {
  const index = join(tmpdir(), `skaro-snapshot-${randomUUID()}`);
  try {
    const env = { GIT_INDEX_FILE: index };
    await git(worktree, ['read-tree', 'HEAD'], { env });
    await git(worktree, ['add', '-A'], { env });
    const tree = (await git(worktree, ['write-tree'], { env })).stdout.trim();
    const head = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
    return { head, tree };
  } finally {
    await rm(index, { force: true });
  }
}

export async function restoreSnapshot(worktree: string, saved: WorktreeSnapshot): Promise<void> {
  await git(worktree, ['reset', '-q', '--hard', saved.head]);
  await git(worktree, ['clean', '-fdq']);
  await git(worktree, ['checkout', saved.tree, '--', '.']);
  await git(worktree, ['reset', '-q']);
}

export async function commitAll(worktree: string, message: string): Promise<boolean> {
  await git(worktree, ['add', '-A']);
  if ((await git(worktree, ['diff', '--cached', '--quiet'], { allowFail: true })).code === 0)
    return false;
  await git(worktree, ['commit', '--no-verify', '-q', '-m', message]);
  return true;
}
