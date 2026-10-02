import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { git, GitService } from './git.ts';

export let dir: string;
export let repo: string;
export let service: GitService;

export async function write(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

export async function commit(
  root: string,
  message: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [path, content] of Object.entries(files)) await write(root, path, content);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-q', '-m', message]);
}

export async function log(root: string, range = 'HEAD'): Promise<string[]> {
  return (await git(root, ['log', '--format=%s', range])).stdout.trim().split('\n');
}

/** A task worktree with one commit on its branch. */
export async function taskWithChange(
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
  service = new GitService(repo, { inspectMounts: async () => [] });
});

afterEach(async () => {
  await git(repo, ['worktree', 'prune'], { allowFail: true });
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
});
