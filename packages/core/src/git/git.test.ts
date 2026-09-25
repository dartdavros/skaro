import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git, GitService, MergeBlockedError } from './git.ts';

let dir: string;
let repo: string;
let service: GitService;

async function write(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

async function commit(root: string, message: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) await write(root, path, content);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-q', '-m', message]);
}

async function log(root: string, range = 'HEAD'): Promise<string[]> {
  return (await git(root, ['log', '--format=%s', range])).stdout.trim().split('\n');
}

/** A task worktree with one commit on its branch. */
async function taskWithChange(
  files: Record<string, string>,
  branch = 'skaro/T-001-a',
): Promise<string> {
  const worktree = join(dir, 'wt', branch.replaceAll('/', '_'));
  await service.createWorktree({ path: worktree, branch, base: 'main' });
  await commit(worktree, 'agent work', files);
  return worktree;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skaro-git-'));
  repo = join(dir, 'repo');
  await mkdir(repo);
  await git(repo, ['init', '-q', '-b', 'main']);
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 'test@skaro.dev'],
    ['core.autocrlf', 'false'],
    ['commit.gpgsign', 'false'],
  ] as const) {
    await git(repo, ['config', k, v]);
  }
  await commit(repo, 'init', {
    'src/math.js': 'export const add = (a, b) => a - b;\n',
    'README.md': '# calc\n',
    '.skaro/tasks/T-001-a.md': '---\nid: T-001\nstatus: in_progress\n---\n',
  });
  service = new GitService(repo);
});

afterEach(async () => {
  await git(repo, ['worktree', 'prune'], { allowFail: true });
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
});

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

  it('removes a worktree with uncommitted changes and tolerates a missing one', async () => {
    const path = await taskWithChange({ 'a.txt': 'a\n' });
    await write(path, 'dirty.txt', 'x');
    await service.removeWorktree(path);
    expect(existsSync(path)).toBe(false);
    await expect(service.removeWorktree(path)).resolves.toBeUndefined();
  });
});

describe('merge checks', () => {
  it('passes for a clean branch with changes', async () => {
    await taskWithChange({
      'src/math.js': 'export const add = (a, b) => a + b;\n',
      'NEW.md': 'x\ny\n',
    });
    const check = await service.checkMerge('main', 'skaro/T-001-a');
    expect(check).toEqual({
      blockers: [],
      baseAhead: 0,
      conflicts: [],
      skaroChanges: [],
      stats: { files: 2, added: 3, removed: 1 },
    });
  });

  it('blocks when the main working copy has uncommitted changes', async () => {
    await taskWithChange({ 'a.txt': 'a\n' });
    await write(repo, 'README.md', '# edited\n');
    expect((await service.checkMerge('main', 'skaro/T-001-a')).blockers).toEqual(['dirty_base']);
  });

  it('ignores uncommitted .skaro changes in the main working copy', async () => {
    await taskWithChange({ 'a.txt': 'a\n' });
    await write(repo, '.skaro/tasks/T-001-a.md', '---\nid: T-001\nstatus: review\n---\n');
    expect((await service.checkMerge('main', 'skaro/T-001-a')).blockers).toEqual([]);
  });

  it('ignores untracked files in the main working copy', async () => {
    await taskWithChange({ 'a.txt': 'a\n' });
    await write(repo, 'notes.txt', 'scratch');
    expect((await service.checkMerge('main', 'skaro/T-001-a')).blockers).toEqual([]);
  });

  it('blocks when the base branch is not checked out', async () => {
    await taskWithChange({ 'a.txt': 'a\n' });
    await git(repo, ['switch', '-q', '-c', 'other']);
    expect((await service.checkMerge('main', 'skaro/T-001-a')).blockers).toEqual(['not_on_base']);
  });

  it('reports conflicts from a trial merge without touching the working copy', async () => {
    await taskWithChange({ 'src/math.js': 'export const add = (a, b) => a + b;\n' });
    await commit(repo, 'base edit', { 'src/math.js': 'export const add = (a, b) => b + a;\n' });
    const check = await service.checkMerge('main', 'skaro/T-001-a');
    expect(check.blockers).toEqual(['conflicts']);
    expect(check.conflicts).toEqual(['src/math.js']);
    expect(check.baseAhead).toBe(1);
    expect(await service.isClean()).toBe(true);
  });

  it('blocks a branch without code changes and lists .skaro changes', async () => {
    await taskWithChange({ '.skaro/tasks/T-001-a.md': '---\nid: T-001\nstatus: done\n---\n' });
    const check = await service.checkMerge('main', 'skaro/T-001-a');
    expect(check.blockers).toEqual(['no_changes']);
    expect(check.skaroChanges).toEqual(['.skaro/tasks/T-001-a.md']);
  });

  it('allows a base that moved ahead without conflicts', async () => {
    await taskWithChange({ 'a.txt': 'a\n' });
    await commit(repo, 'unrelated', { 'b.txt': 'b\n' });
    const check = await service.checkMerge('main', 'skaro/T-001-a');
    expect(check.blockers).toEqual([]);
    expect(check.baseAhead).toBe(1);
  });
});

describe('merge', () => {
  it('squashes the branch into one commit with the task file and without .skaro changes', async () => {
    const worktree = await taskWithChange({
      'src/math.js': 'export const add = (a, b) => a + b;\n',
      '.skaro/tasks/T-001-a.md': '---\nid: T-001\nstatus: hacked\n---\n',
      '.skaro/adr/0001-agent.md': 'agent wrote this\n',
    });
    await commit(worktree, 'agent work 2', { 'docs.md': 'docs\n' });

    const { commit: sha, check } = await service.merge({
      base: 'main',
      branch: 'skaro/T-001-a',
      strategy: 'squash',
      message: 'T-001: fix add',
      beforeCommit: async () => {
        await write(repo, '.skaro/tasks/T-001-a.md', '---\nid: T-001\nstatus: done\n---\n');
        return ['.skaro/tasks/T-001-a.md'];
      },
    });

    expect(check.skaroChanges.sort()).toEqual([
      '.skaro/adr/0001-agent.md',
      '.skaro/tasks/T-001-a.md',
    ]);
    expect(await log(repo)).toEqual(['T-001: fix add', 'init']);
    expect(await service.head()).toBe(sha);
    expect(await readFile(join(repo, 'src/math.js'), 'utf8')).toContain('a + b');
    expect(await readFile(join(repo, 'docs.md'), 'utf8')).toBe('docs\n');
    expect(await readFile(join(repo, '.skaro/tasks/T-001-a.md'), 'utf8')).toContain('status: done');
    expect(existsSync(join(repo, '.skaro/adr/0001-agent.md'))).toBe(false);
    expect(await service.isClean()).toBe(true);
    const changed = (await git(repo, ['show', '--name-only', '--format=', sha])).stdout
      .trim()
      .split('\n')
      .sort();
    expect(changed).toEqual(['.skaro/tasks/T-001-a.md', 'docs.md', 'src/math.js']);
  });

  it('keeps uncommitted .skaro edits of other tasks, after a merge and after a failed one', async () => {
    await commit(repo, 'second task', {
      '.skaro/tasks/T-002-b.md': '---\nid: T-002\nstatus: todo\n---\n',
    });
    const worktree = await taskWithChange({ 'a.txt': 'a\n' });
    const other = '---\nid: T-002\nstatus: in_progress\n---\n';
    await write(repo, '.skaro/tasks/T-002-b.md', other);

    await expect(
      service.merge({
        base: 'main',
        branch: 'skaro/T-001-a',
        strategy: 'squash',
        message: 'm',
        beforeCommit: () => Promise.reject(new Error('task file write failed')),
      }),
    ).rejects.toThrow('task file write failed');
    expect(await readFile(join(repo, '.skaro/tasks/T-002-b.md'), 'utf8')).toBe(other);

    await commit(worktree, 'agent work 2', { 'c.txt': 'c\n' });
    const { commit: sha } = await service.merge({
      base: 'main',
      branch: 'skaro/T-001-a',
      strategy: 'squash',
      message: 'T-001',
    });
    expect(await readFile(join(repo, '.skaro/tasks/T-002-b.md'), 'utf8')).toBe(other);
    const changed = (await git(repo, ['show', '--name-only', '--format=', sha])).stdout
      .trim()
      .split('\n')
      .sort();
    expect(changed).toEqual(['a.txt', 'c.txt']);
  });

  it('commits everything left in a worktree', async () => {
    const worktree = await taskWithChange({ 'a.txt': 'a\n' });
    expect(await service.commitAll(worktree, 'T-001: rest')).toBe(false);
    await write(worktree, 'new.txt', 'untracked\n');
    await write(worktree, 'a.txt', 'changed\n');
    expect(await service.commitAll(worktree, 'T-001: rest')).toBe(true);
    expect(await log(worktree)).toEqual(['T-001: rest', 'agent work', 'init']);
    expect((await git(worktree, ['status', '--porcelain'])).stdout.trim()).toBe('');
  });

  it('creates a merge commit with the merge strategy', async () => {
    await taskWithChange({ 'a.txt': 'a\n' });
    await commit(repo, 'unrelated', { 'b.txt': 'b\n' });
    const { commit: sha } = await service.merge({
      base: 'main',
      branch: 'skaro/T-001-a',
      strategy: 'merge',
      message: 'Merge T-001',
    });
    const parents = (await git(repo, ['rev-list', '--parents', '-n', '1', sha])).stdout
      .trim()
      .split(' ');
    expect(parents).toHaveLength(3);
    expect(existsSync(join(repo, 'a.txt'))).toBe(true);
    expect(existsSync(join(repo, 'b.txt'))).toBe(true);
  });

  it('refuses to merge when blocked', async () => {
    await taskWithChange({ 'a.txt': 'a\n' });
    await write(repo, 'README.md', '# dirty\n');
    const error = await service
      .merge({ base: 'main', branch: 'skaro/T-001-a', strategy: 'squash', message: 'm' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MergeBlockedError);
    expect((error as MergeBlockedError).check.blockers).toEqual(['dirty_base']);
    expect(await log(repo)).toEqual(['init']);
  });

  it('restores the working copy when the merge fails midway', async () => {
    await taskWithChange({ 'src/math.js': 'export const add = (a, b) => a + b;\n' });
    for (const strategy of ['squash', 'merge'] as const) {
      await expect(
        service.merge({
          base: 'main',
          branch: 'skaro/T-001-a',
          strategy,
          message: 'm',
          beforeCommit: () => Promise.reject(new Error('task file write failed')),
        }),
      ).rejects.toThrow('task file write failed');
      expect(await log(repo)).toEqual(['init']);
      expect(await service.isClean()).toBe(true);
      expect(await readFile(join(repo, 'src/math.js'), 'utf8')).toContain('a - b');
      expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false);
    }
  });
});

describe('rebase', () => {
  it('updates the task branch onto the moved base', async () => {
    const worktree = await taskWithChange({ 'a.txt': 'a\n' });
    await commit(repo, 'unrelated', { 'b.txt': 'b\n' });
    expect(await service.rebase(worktree, 'main')).toEqual({ ok: true });
    expect(await log(worktree)).toEqual(['agent work', 'unrelated', 'init']);
    expect((await service.checkMerge('main', 'skaro/T-001-a')).baseAhead).toBe(0);
  });

  it('aborts on conflicts and reports the files', async () => {
    const worktree = await taskWithChange({
      'src/math.js': 'export const add = (a, b) => a + b;\n',
    });
    await commit(repo, 'base edit', { 'src/math.js': 'export const add = (a, b) => b + a;\n' });
    expect(await service.rebase(worktree, 'main')).toEqual({
      ok: false,
      conflicts: ['src/math.js'],
    });
    expect(await log(worktree)).toEqual(['agent work', 'init']);
    expect(await service.isClean(worktree)).toBe(true);
  });
});

describe('revert', () => {
  it('reverts a squash merge', async () => {
    await taskWithChange({ 'src/math.js': 'export const add = (a, b) => a + b;\n' });
    const { commit: sha } = await service.merge({
      base: 'main',
      branch: 'skaro/T-001-a',
      strategy: 'squash',
      message: 'T-001',
    });
    const result = await service.revert(sha, 'Revert T-001');
    expect(result.ok).toBe(true);
    expect(await log(repo)).toEqual(['Revert T-001', 'T-001', 'init']);
    expect(await readFile(join(repo, 'src/math.js'), 'utf8')).toContain('a - b');
  });

  it('reverts a merge commit against its first parent', async () => {
    await taskWithChange({ 'a.txt': 'a\n' });
    const { commit: sha } = await service.merge({
      base: 'main',
      branch: 'skaro/T-001-a',
      strategy: 'merge',
      message: 'Merge',
    });
    expect((await service.revert(sha)).ok).toBe(true);
    expect(existsSync(join(repo, 'a.txt'))).toBe(false);
  });

  it('aborts when later commits conflict with the revert', async () => {
    await taskWithChange({ 'src/math.js': 'export const add = (a, b) => a + b;\n' });
    const { commit: sha } = await service.merge({
      base: 'main',
      branch: 'skaro/T-001-a',
      strategy: 'squash',
      message: 'T-001',
    });
    await commit(repo, 'later', { 'src/math.js': 'export const add = (a, b) => a + b + 0;\n' });
    expect(await service.revert(sha)).toEqual({ ok: false, conflicts: ['src/math.js'] });
    expect(await log(repo)).toEqual(['later', 'T-001', 'init']);
    expect(await service.isClean()).toBe(true);
  });

  it('refuses to revert over uncommitted changes', async () => {
    await taskWithChange({ 'a.txt': 'a\n' });
    const { commit: sha } = await service.merge({
      base: 'main',
      branch: 'skaro/T-001-a',
      strategy: 'squash',
      message: 'T-001',
    });
    await write(repo, 'README.md', '# dirty\n');
    await expect(service.revert(sha)).rejects.toThrow('uncommitted');
  });
});
