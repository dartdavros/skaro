import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDb, ArtifactStore, AttachmentStore, git } from '@skaro/core';
import type { McpHttpServer, SkaroScope } from '@skaro/mcp-server';
import { afterEach, beforeEach, expect } from 'vitest';
import type { AgentManager } from './agents';
import { Projects } from './projects';
import { TaskRuns, type TaskRunDeps } from './tasks';

export let dir: string;
export let repo: string;
export let worktree: string;
export let db: AppDb;
export let projects: Projects;
export let tasks: TaskRuns;
export let projectId: string;
export let taskId: string;
export let runId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skaro-task-retention-'));
  repo = join(dir, 'repo');
  worktree = join(dir, 'worktree');
  await mkdir(repo);
  await git(repo, ['init', '-qb', 'main']);
  await git(repo, ['config', 'user.name', 'Test']);
  await git(repo, ['config', 'user.email', 'test@skaro.dev']);
  await git(repo, ['config', 'commit.gpgsign', 'false']);
  const store = new ArtifactStore(repo);
  const task = await store.createTask({
    title: 'Retain checkout',
    body: '## Критерии приёмки\n\n- [x] Preserve runtime\n',
  });
  taskId = task.id;
  await writeFile(join(repo, '.gitignore'), 'data/\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-qm', 'init']);
  db = AppDb.open(':memory:');
  projectId = db.addProject({ name: 'Runtime safety', path: repo }).id;
  projects = new Projects(db, () => undefined);
  await projects
    .get(projectId)
    .git.createWorktree({ path: worktree, branch: 'skaro/retain', base: 'main' });
  await writeFile(join(worktree, 'feature.txt'), 'feature');
  await mkdir(join(worktree, 'data', 'postgres'), { recursive: true });
  await writeFile(join(worktree, 'data', 'postgres', 'PG_VERSION'), '16');
  runId = db.createRun({
    projectId,
    taskId,
    agent: 'codex',
    worktree,
    branch: 'skaro/retain',
    logPath: 'runs/test.jsonl',
    adapterVersion: 'test',
  }).id;
  // No model, agent process or substitute application backend is launched by this test.
  tasks = createTaskRuns();
  await tasks.open(projectId, taskId);
});

function createTaskRuns(): TaskRuns {
  return new TaskRuns(taskRunDeps());
}

export function taskRunDeps(): TaskRunDeps {
  return {
    db,
    dataDir: dir,
    projects,
    agents: { defaults: () => ({}), readyAgent: (id: string) => id } as unknown as AgentManager,
    attachments: new AttachmentStore(join(dir, 'attachments')),
    mcp: {} as McpHttpServer<SkaroScope>,
    emit: () => undefined,
    locale: () => 'ru',
    // The machine's real Docker is never inspected or changed by these tests.
    docker: {
      inspect: async () => [],
      stop: async () => undefined,
      remove: async () => [],
      hasData: async () => false,
      ports: async (count) => Array.from({ length: count }, (_, i) => 20_000 + i),
    },
  };
}

export function scope(): SkaroScope {
  return { kind: 'task', projectId, taskId, runId };
}

export async function expectMergedWithoutCard(): Promise<string> {
  expect((await projects.get(projectId).store.readTask(taskId)).status).toBe('done');
  expect((await tasks.open(projectId, taskId)).timeline?.interactions).toEqual([]);
  const merges = db.listMerges(projectId, taskId);
  expect(merges).toHaveLength(1);
  expect((await git(repo, ['rev-parse', 'main'])).stdout.trim()).toBe(merges[0]!.commit);
  return merges[0]!.commit;
}

afterEach(async () => {
  await tasks?.close();
  projects?.close();
  db?.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
});

export function resetTaskRuns(): void {
  tasks = createTaskRuns();
}
