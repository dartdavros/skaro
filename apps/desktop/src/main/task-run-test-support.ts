import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { AppDb, ArtifactStore, AttachmentStore, git } from '@skaro/core';
import { McpHttpServer, type SkaroScope } from '@skaro/mcp-server';
import { afterEach, beforeEach, expect } from 'vitest';
import { AgentManager } from './agents';
import { Projects } from './projects';
import { TaskRuns, type TaskRunDeps } from './tasks';
import { prepareFixtureArchitecture, reviewFixtureResult } from './c4-test-support';
import { closeBackground } from './background/client';
import { TaskRunEngine } from './task-run-engine';

export let dir: string;
export let repo: string;
export let worktree: string;
export let db: AppDb;
export let projects: Projects;
export let tasks: TaskRuns;
export let projectId: string;
export let taskId: string;
export let runId: string;
let closeRuns: (() => Promise<void>) | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skaro-task-retention-'));
  repo = join(dir, 'repo');
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
  await prepareFixtureArchitecture(repo);
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-qm', 'init']);
  db = AppDb.open(join(dir, 'skaro.db'));
  projectId = db.addProject({ name: 'Runtime safety', path: repo }).id;
  worktree = join(dir, 'worktrees', projectId, taskId);
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
  await reviewFixtureResult(db, projects, projectId, taskId, runId);
});

function createTaskRuns(): TaskRuns {
  const runs = new TaskRuns(taskRunDeps());
  closeRuns = () => runs.close();
  return runs;
}

export function taskRunDeps(): TaskRunDeps {
  return {
    db,
    dataDir: dir,
    projects,
    agents: new AgentManager({
      agentsDir: join(dir, 'agents'),
      scratchDir: join(dir, 'scratch'),
      store: {
        getSetting: (key) => db.getSetting(key, null),
        setSetting: (key, value) => db.setSetting(key, value),
      },
      openUrl: () => undefined,
      onChange: () => undefined,
    }),
    attachments: new AttachmentStore(join(dir, 'attachments')),
    mcp: new McpHttpServer<SkaroScope>({ name: 'skaro', version: 'test', tools: [] }),
    emit: () => undefined,
    locale: () => 'ru',
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
  await closeRuns?.();
  projects?.close();
  await closeBackground();
  db?.close();
  const cleanup = resolve(dir);
  const inside = relative(resolve(tmpdir()), cleanup);
  if (
    !inside ||
    isAbsolute(inside) ||
    inside.startsWith('..') ||
    !inside.startsWith('skaro-task-retention-')
  )
    throw new Error(`Refuse fixture cleanup outside its temporary root: ${cleanup}`);
  await rm(cleanup, { recursive: true, force: true, maxRetries: 3 });
});

export function resetTaskRuns(): void {
  reopenDatabase();
  tasks = createTaskRuns();
}

/** Replace the whole host scope, preserving SQLite records without a second live controller. */
export async function restartTaskEngine(slots = 3): Promise<TaskRunEngine> {
  await closeRuns?.();
  reopenDatabase();
  const engine = new TaskRunEngine(taskRunDeps(), slots);
  closeRuns = () => engine.sessions.close();
  return engine;
}

function reopenDatabase(): void {
  projects.close();
  db.close();
  db = AppDb.open(join(dir, 'skaro.db'));
  projects = new Projects(db, () => undefined);
}
