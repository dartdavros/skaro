import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dir, service, write, taskWithChange } from './git-test-support.ts';

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
