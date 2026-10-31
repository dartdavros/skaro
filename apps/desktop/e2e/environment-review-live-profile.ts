import {
  AppDb,
  ArtifactStore,
  AttachmentStore,
  expand,
  git,
  type EnvironmentIdentity,
} from '@skaro/core';
import { continuationTimeline, replayRunLog, runEvent, Timeline } from '@skaro/timeline';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { EnvironmentRecord } from '../src/main/task-environment-registry';
import type { TaskResult } from '../src/main/completion-store';
import { projectorFor, readRunLog } from '../src/main/session-log';
import { tempUserData } from './launch';
import { assertIdleLiveDocker, volumeIdentity } from './environment-review-live-docker';

type Row = Record<string, SQLInputValue>;
export interface LiveReviewTask {
  projectId: string;
  taskId: string;
  title: string;
  identity: EnvironmentIdentity;
  url: string;
  ready: string;
  readyTemplate: string;
  volumes: string[];
}

function setting<T>(db: DatabaseSync, key: string): T | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? (JSON.parse(String(row.value)) as T) : undefined;
}

function insert(db: DatabaseSync, table: 'projects' | 'runs', row: Row): void {
  const columns = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${columns.map((key) => `"${key}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
  ).run(...columns.map((key) => row[key]!));
}

function inside(root: string, path: string): string {
  const full = resolve(root, path);
  const suffix = relative(resolve(root), full);
  if (
    isAbsolute(suffix) ||
    suffix === '..' ||
    suffix.startsWith('..\\') ||
    suffix.startsWith('../')
  )
    throw new Error('The saved run log must stay inside its own profile');
  return full;
}

/** Never launch a second owner of the existing Docker environments. */
function assertSkaroClosed(profile: string): void {
  if (process.platform !== 'win32') throw new Error('This live Chatballs check requires Windows');
  const active = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "@(Get-Process Skaro,electron -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq 'Skaro' -or $_.Path -match '[\\\\/]Skaro[\\\\/]' }).Count",
    ],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
  if (Number(active) !== 0 || existsSync(join(profile, 'SingletonLock')))
    throw new Error('Close the existing Skaro process before running the live environment check');
}

async function assertNoMergeCard(db: AppDb, userData: string, task: LiveReviewTask): Promise<void> {
  const chain = [];
  let run = db.listRuns(task.projectId, task.taskId)[0];
  while (run) {
    chain.unshift(run);
    const previous = run.previousRunId;
    run = previous ? db.getRun(previous) : undefined;
    if (previous && !run) throw new Error('A saved predecessor is missing');
  }
  const attachments = new AttachmentStore(join(userData, 'attachments'));
  let timeline = new Timeline();
  for (const entry of chain) {
    if (entry.previousRunId) timeline = continuationTimeline(timeline.state);
    const lines = await readRunLog(inside(userData, entry.logPath), true);
    const events = replayRunLog(
      lines,
      entry.startedAt,
      await projectorFor(entry.agent),
      (image) => attachments.save(image),
      (event) => (entry.previousRunId ? runEvent(event, entry.id) : event),
    );
    for (const event of events) timeline.apply(event);
  }
  if (timeline.state.interactions.some((item) => item.kind === 'merge'))
    throw new Error(`${task.taskId}: an open merge card could create an integration candidate`);
}

/** A subset of actual records, never seeded tasks, rewritten artifacts or substitute services. */
export async function prepareLiveReviewProfile(profile: string, taskIds: string[]) {
  assertSkaroClosed(profile);
  if (new Set(taskIds).size !== 2) throw new Error('Select exactly two distinct real task IDs');
  const source = new DatabaseSync(join(profile, 'skaro.db'), { readOnly: true });
  const userData = tempUserData();
  AppDb.open(join(userData, 'skaro.db')).close();
  const target = new DatabaseSync(join(userData, 'skaro.db'));
  const records = setting<EnvironmentRecord[]>(source, 'environments') ?? [];
  const tasks: LiveReviewTask[] = [];
  const kept: EnvironmentRecord[] = [];
  const projects = new Set<string>();
  const settings = new Map<string, unknown>();
  try {
    for (const taskId of taskIds) {
      const matches = records.filter((record) => record.taskId === taskId);
      if (matches.length !== 1 || !matches[0]?.created)
        throw new Error(`${taskId}: requires one existing, already-created environment`);
      const record = matches[0];
      const project = source
        .prepare('SELECT * FROM projects WHERE id = ?')
        .get(record.projectId) as Row;
      if (!project) throw new Error(`${taskId}: project is missing`);
      const root = String(project.path);
      const artifacts = await new ArtifactStore(root).load();
      const task = artifacts.tasks.find((item) => item.id === taskId);
      const config = artifacts.config.environment;
      if (!task || task.status !== 'review' || !config?.ready)
        throw new Error(
          `${taskId}: requires an existing review task and documented HTTP readiness`,
        );
      if (
        !task.milestone ||
        artifacts.tasks
          .filter((item) => item.milestone === task.milestone && !item.archived)
          .every((item) => ['review', 'done', 'cancelled'].includes(item.status))
      )
        throw new Error(
          `${taskId}: opening a completed stage could prepare a merge; select an unfinished stage`,
        );
      if (!projects.has(record.projectId)) {
        const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
        if ((await readdir(gitDir)).some((entry) => entry.startsWith('skaro-merge-recovery-')))
          throw new Error('The original repository has publication recovery pending');
        insert(target, 'projects', project);
        projects.add(record.projectId);
        // Native startup reconciles completion even with automatic merging disabled.
        // Existing accepted results prevent importing legacy results with Git writes.
        for (const review of artifacts.tasks.filter(
          (item) => item.status === 'review' && !item.archived,
        )) {
          const key = `completion.${record.projectId}.result.${review.id}`;
          const result = setting<TaskResult>(source, key);
          if (!result || result.pendingReview)
            throw new Error(`${review.id}: no settled actual completion record`);
          const ancestry = await git(
            root,
            ['merge-base', '--is-ancestor', result.head, artifacts.config.baseBranch],
            { allowFail: true },
          );
          if (ancestry.code !== 1)
            throw new Error(`${review.id}: startup might publish an already-merged result`);
          settings.set(key, result);
        }
      }
      const runs = source
        .prepare(
          'SELECT * FROM runs WHERE project_id = ? AND task_id = ? ORDER BY started_at, rowid',
        )
        .all(record.projectId, taskId) as Row[];
      if (!runs.length || runs.at(-1)?.retired_at)
        throw new Error(`${taskId}: no current real run`);
      for (const run of runs) {
        const path = String(run.log_path);
        const sourceLog = inside(profile, path);
        const targetLog = inside(userData, path);
        await mkdir(dirname(targetLog), { recursive: true });
        await copyFile(sourceLog, targetLog);
        insert(target, 'runs', run);
      }
      const worktree = record.worktree ?? join(profile, 'worktrees', record.projectId, taskId);
      if (!existsSync(worktree)) throw new Error(`${taskId}: existing worktree is missing`);
      const identity = { name: record.name, root, worktree, ports: record.ports };
      const url = expand(
        config.urls.frontend ?? Object.values(config.urls)[0] ?? config.ready,
        identity,
      );
      const ready = expand(config.ready, identity);
      if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(ready))
        throw new Error(`${taskId}: expected the documented local HTTP readiness endpoint`);
      await assertIdleLiveDocker(identity.name);
      tasks.push({
        projectId: record.projectId,
        taskId,
        title: task.title,
        identity,
        url,
        ready,
        readyTemplate: config.ready,
        volumes: await volumeIdentity(identity.name),
      });
      kept.push({ ...record, worktree });
    }
    if (projects.size !== 1) throw new Error('Select two existing tasks from the same project');
    for (const [key, value] of settings)
      target
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
        .run(key, JSON.stringify(value));
    target.close();
    const db = AppDb.open(join(userData, 'skaro.db'));
    try {
      for (const task of tasks) await assertNoMergeCard(db, userData, task);
      db.setSetting('environments', kept);
      db.setSetting('runs.slots', 1);
      db.setSetting('ui.locale', 'ru');
      db.setSetting('ui.navCollapsed', false);
      db.setOpenTabs([...projects], tasks[0]!.projectId);
    } finally {
      db.close();
    }
    return { userData, tasks };
  } finally {
    source.close();
    if (target.isOpen) target.close();
  }
}
