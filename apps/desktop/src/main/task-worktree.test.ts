import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, GitService } from '@skaro/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareTaskWorktree } from './task-worktree';

let dataDir: string;
let repo: string;
let service: GitService;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'skaro-task-worktree-'));
  repo = join(dataDir, 'repo');
  await mkdir(repo);
  await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@skaro.dev',
    'commit',
    '--allow-empty',
    '-qm',
    'init',
  ]);
  service = new GitService(repo);
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('task worktree retries', () => {
  it('reuses its checkout without removing ignored runtime data', async () => {
    const options = {
      git: service,
      dataDir,
      projectId: 'p1',
      taskId: 'T-001',
      branch: 'skaro/T-001',
      base: 'main',
    };
    const path = await prepareTaskWorktree(options);
    await mkdir(join(path, 'data'));
    await writeFile(join(path, 'data', 'saved'), 'existing data');
    expect(await prepareTaskWorktree(options)).toBe(path);
    expect(await readFile(join(path, 'data', 'saved'), 'utf8')).toBe('existing data');
  });

  it('refuses to replace a checkout belonging to a different branch', async () => {
    const options = {
      git: service,
      dataDir,
      projectId: 'p1',
      taskId: 'T-001',
      branch: 'skaro/T-001',
      base: 'main',
    };
    const path = await prepareTaskWorktree(options);
    await git(path, ['switch', '-qc', 'another-task']);
    await expect(prepareTaskWorktree(options)).rejects.toThrow('retained');
    expect(await service.currentBranch(path)).toBe('another-task');
  });
});
