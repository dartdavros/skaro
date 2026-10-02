import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git } from './git.ts';
import { dir, service, write, commit, taskWithChange, log } from './git-test-support.ts';

describe('worktrees', () => {
  it('creates a branch from base, reuses it, and removes both', async () => {
    const path = join(dir, 'wt1');
    await service.createWorktree({ path, branch: 'skaro/T-001-a', base: 'main' });
    expect(await service.currentBranch(path)).toBe('skaro/T-001-a');
    await service.removeWorktree(path);
    expect(existsSync(path)).toBe(false);
    expect(await service.branchExists('skaro/T-001-a')).toBe(true);

    await service.createWorktree({ path, branch: 'skaro/T-001-a', base: 'main' });
    expect(await service.currentBranch(path)).toBe('skaro/T-001-a');
    await service.removeWorktree(path, { deleteBranch: 'skaro/T-001-a' });
    expect(await service.branchExists('skaro/T-001-a')).toBe(false);
  });

  it('retains uncommitted work and tolerates a missing worktree', async () => {
    const path = await taskWithChange({ 'a.txt': 'a\n' });
    await write(path, 'dirty.txt', 'x');
    await expect(service.removeWorktree(path)).rejects.toThrow('untracked');
    expect(existsSync(path)).toBe(true);
    await expect(service.removeWorktree(join(dir, 'missing'))).resolves.toBeUndefined();
  });
});

describe('snapshots', () => {
  it('puts a worktree back: commits, edits and new files after the snapshot go away', async () => {
    const worktree = await taskWithChange({ 'a.txt': 'a\n' });
    await write(worktree, 'draft.txt', 'untracked before\n');
    await write(worktree, 'a.txt', 'edited before\n');
    const snap = await service.snapshot(worktree);
    expect((await git(worktree, ['status', '--porcelain'])).stdout).toContain('draft.txt');

    await commit(worktree, 'agent went on', { 'b.txt': 'b\n', 'a.txt': 'later\n' });
    await write(worktree, 'c.txt', 'c\n');
    await service.restoreSnapshot(worktree, snap);

    expect(await readFile(join(worktree, 'a.txt'), 'utf8')).toBe('edited before\n');
    expect(await readFile(join(worktree, 'draft.txt'), 'utf8')).toBe('untracked before\n');
    expect(existsSync(join(worktree, 'b.txt'))).toBe(false);
    expect(existsSync(join(worktree, 'c.txt'))).toBe(false);
    expect(await log(worktree)).toEqual(['agent work', 'init']);
    // Edits come back uncommitted, as they were.
    expect((await git(worktree, ['diff', '--cached', '--name-only'])).stdout.trim()).toBe('');
  });
});
