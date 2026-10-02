import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitService } from './git.ts';
import { containsPath } from './worktree-safety.ts';
import { repo, service, write, taskWithChange } from './git-test-support.ts';

describe('worktree removal safety', () => {
  it('retains ignored database files and the branch, even after a merge', async () => {
    const path = await taskWithChange({ 'change.txt': 'change', '.gitignore': 'data/\n' });
    await write(path, 'data/postgres/PG_VERSION', '16');
    await service.merge({
      base: 'main',
      branch: 'skaro/T-001-a',
      strategy: 'squash',
      message: 'merge',
    });
    await expect(service.removeWorktree(path, { deleteBranch: 'skaro/T-001-a' })).rejects.toThrow(
      'ignored',
    );
    expect(await readFile(join(path, 'data/postgres/PG_VERSION'), 'utf8')).toBe('16');
    expect(await service.branchExists('skaro/T-001-a')).toBe(true);
  });

  it('retains a clean worktree referenced by a container mount', async () => {
    const path = await taskWithChange({ 'change.txt': 'change' });
    const guarded = new GitService(repo, {
      inspectMounts: async () => [
        { Name: '/backend', Mounts: [{ Type: 'bind', Source: join(path, 'apps/backend') }] },
      ],
    });
    await expect(guarded.removeWorktree(path)).rejects.toThrow('/backend');
    expect(existsSync(path)).toBe(true);
  });

  it('retains a worktree when Docker inspection fails', async () => {
    const path = await taskWithChange({ 'change.txt': 'change' });
    const guarded = new GitService(repo, {
      inspectMounts: async () => {
        throw new Error('daemon unavailable');
      },
    });
    await expect(guarded.removeWorktree(path)).rejects.toThrow('could not be checked');
    expect(existsSync(path)).toBe(true);
  });

  it('cannot delete the main working copy', async () => {
    await expect(service.removeWorktree(repo)).rejects.toThrow('main working copy');
    expect(existsSync(repo)).toBe(true);
  });

  it('retains tracked edits and uses separator boundaries for container paths', async () => {
    const path = await taskWithChange({ 'change.txt': 'change' });
    await write(path, 'change.txt', 'edited');
    await expect(service.removeWorktree(path)).rejects.toThrow('changed');
    expect(containsPath(path, `${path}-other`)).toBe(false);
    expect(containsPath(path, join(path, 'data'))).toBe(true);
  });
});
