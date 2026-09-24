// App database (docs/architecture.md, section 4): everything that must not live in git —
// projects, tabs, settings, runtime task state, run/chat indexes, merges, open interactions.

import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { TaskRuntime } from '../status.ts';

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  lastOpenedAt?: number;
}

export type RunOutcome = 'done' | 'interrupted' | 'failed';

export interface RunRecord {
  id: string;
  projectId: string;
  taskId: string;
  agent: string;
  model?: string;
  worktree?: string;
  branch?: string;
  logPath: string;
  adapterVersion: string;
  nativeSessionId?: string;
  startedAt: number;
  endedAt?: number;
  outcome?: RunOutcome;
}

export interface ChatRecord {
  id: string;
  projectId: string;
  /** Set for a task chat, empty for a project chat. */
  taskId?: string;
  agent: string;
  title: string;
  nativeSessionId?: string;
  logPath: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MergeRecord {
  id: string;
  projectId: string;
  taskId: string;
  branch: string;
  commit: string;
  strategy: 'squash' | 'merge';
  mergedAt: number;
  revertCommit?: string;
}

export interface InteractionRecord {
  id: string;
  projectId: string;
  runId?: string;
  chatId?: string;
  kind: string;
  /** Canonical interaction (agent-output.md, section 3). */
  payload: unknown;
  openedAt: number;
  closedAt?: number;
  resolution?: string;
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_opened_at INTEGER
  );
  CREATE TABLE open_tabs (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE task_runtime (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    state TEXT NOT NULL,
    run_id TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, task_id)
  );
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    agent TEXT NOT NULL,
    model TEXT,
    worktree TEXT,
    branch TEXT,
    log_path TEXT NOT NULL,
    adapter_version TEXT NOT NULL,
    native_session_id TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    outcome TEXT
  );
  CREATE INDEX runs_task ON runs(project_id, task_id, started_at);
  CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id TEXT,
    agent TEXT NOT NULL,
    title TEXT NOT NULL,
    native_session_id TEXT,
    log_path TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX chats_project ON chats(project_id, updated_at);
  CREATE TABLE merges (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    branch TEXT NOT NULL,
    merge_commit TEXT NOT NULL,
    strategy TEXT NOT NULL,
    merged_at INTEGER NOT NULL,
    revert_commit TEXT
  );
  CREATE TABLE interactions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    run_id TEXT,
    chat_id TEXT,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    opened_at INTEGER NOT NULL,
    closed_at INTEGER,
    resolution TEXT
  );
  `,
];

type Row = Record<string, SQLInputValue>;

export class AppDb {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  private constructor(db: DatabaseSync, now: () => number) {
    this.db = db;
    this.now = now;
  }

  /** Opens (and migrates) the database; `:memory:` for tests. */
  static open(path: string, now: () => number = Date.now): AppDb {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    const version = Number(
      (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    );
    for (let v = version; v < MIGRATIONS.length; v++) {
      db.exec('BEGIN');
      try {
        db.exec(MIGRATIONS[v]!);
        db.exec(`PRAGMA user_version = ${v + 1}`);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
    return new AppDb(db, now);
  }

  close(): void {
    this.db.close();
  }

  get schemaVersion(): number {
    return Number(
      (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    );
  }

  // ── projects and tabs ────────────────────────────────────────────────────

  addProject(input: { name: string; path: string }): ProjectRecord {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)')
      .run(id, input.name, input.path, this.now());
    return this.getProject(id)!;
  }

  getProject(id: string): ProjectRecord | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined;
    return row && toProject(row);
  }

  findProjectByPath(path: string): ProjectRecord | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as
      Row | undefined;
    return row && toProject(row);
  }

  /** Most recently opened first. */
  listProjects(): ProjectRecord[] {
    return (
      this.db
        .prepare('SELECT * FROM projects ORDER BY COALESCE(last_opened_at, created_at) DESC')
        .all() as Row[]
    ).map(toProject);
  }

  touchProject(id: string): void {
    this.db.prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?').run(this.now(), id);
  }

  renameProject(id: string, name: string): void {
    this.db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, id);
  }

  /** Forgets the project in Skaro; files on disk are untouched. */
  removeProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  getOpenTabs(): { projectId: string; active: boolean }[] {
    return (
      this.db.prepare('SELECT project_id, active FROM open_tabs ORDER BY position').all() as Row[]
    ).map((r) => ({
      projectId: String(r['project_id']),
      active: r['active'] === 1,
    }));
  }

  setOpenTabs(projectIds: string[], activeId?: string): void {
    this.transaction(() => {
      this.db.exec('DELETE FROM open_tabs');
      const insert = this.db.prepare(
        'INSERT INTO open_tabs (project_id, position, active) VALUES (?, ?, ?)',
      );
      projectIds.forEach((id, i) => insert.run(id, i, id === activeId ? 1 : 0));
    });
  }

  // ── settings ─────────────────────────────────────────────────────────────

  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      Row | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(String(row['value'])) as T;
    } catch {
      return fallback;
    }
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, JSON.stringify(value));
  }

  // ── runtime task state ───────────────────────────────────────────────────

  setTaskRuntime(projectId: string, taskId: string, state: TaskRuntime, runId?: string): void {
    if (state === 'idle') {
      this.db
        .prepare('DELETE FROM task_runtime WHERE project_id = ? AND task_id = ?')
        .run(projectId, taskId);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO task_runtime (project_id, task_id, state, run_id, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, task_id) DO UPDATE SET state = excluded.state, run_id = excluded.run_id, updated_at = excluded.updated_at`,
      )
      .run(projectId, taskId, state, runId ?? null, this.now());
  }

  getTaskRuntime(projectId: string): Map<string, { state: TaskRuntime; runId?: string }> {
    const rows = this.db
      .prepare('SELECT * FROM task_runtime WHERE project_id = ?')
      .all(projectId) as Row[];
    return new Map(
      rows.map((r) => [
        String(r['task_id']),
        { state: r['state'] as TaskRuntime, runId: opt(r['run_id']) },
      ]),
    );
  }

  /**
   * After a restart no agent process is alive: running and queued tasks become idle.
   * Waiting tasks keep their state — their open interactions are shown again (agent-output.md, 6).
   */
  resetStaleRuntime(): { projectId: string; taskId: string; state: TaskRuntime }[] {
    const rows = this.db
      .prepare("SELECT * FROM task_runtime WHERE state IN ('running', 'queued')")
      .all() as Row[];
    this.db.exec("DELETE FROM task_runtime WHERE state IN ('running', 'queued')");
    return rows.map((r) => ({
      projectId: String(r['project_id']),
      taskId: String(r['task_id']),
      state: r['state'] as TaskRuntime,
    }));
  }

  // ── runs ─────────────────────────────────────────────────────────────────

  createRun(
    input: Omit<RunRecord, 'id' | 'startedAt' | 'endedAt' | 'outcome' | 'nativeSessionId'>,
  ): RunRecord {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO runs (id, project_id, task_id, agent, model, worktree, branch, log_path, adapter_version, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.taskId,
        input.agent,
        input.model ?? null,
        input.worktree ?? null,
        input.branch ?? null,
        input.logPath,
        input.adapterVersion,
        this.now(),
      );
    return this.getRun(id)!;
  }

  getRun(id: string): RunRecord | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined;
    return row && toRun(row);
  }

  setRunSession(id: string, nativeSessionId: string): void {
    this.db.prepare('UPDATE runs SET native_session_id = ? WHERE id = ?').run(nativeSessionId, id);
  }

  finishRun(id: string, outcome: RunOutcome): void {
    this.db
      .prepare('UPDATE runs SET ended_at = ?, outcome = ? WHERE id = ?')
      .run(this.now(), outcome, id);
  }

  /** Newest first. */
  listRuns(projectId: string, taskId?: string): RunRecord[] {
    const rows = (
      taskId
        ? this.db
            .prepare(
              'SELECT * FROM runs WHERE project_id = ? AND task_id = ? ORDER BY started_at DESC, rowid DESC',
            )
            .all(projectId, taskId)
        : this.db
            .prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC, rowid DESC')
            .all(projectId)
    ) as Row[];
    return rows.map(toRun);
  }

  // ── chats ────────────────────────────────────────────────────────────────

  createChat(input: {
    projectId: string;
    taskId?: string;
    agent: string;
    title: string;
    logPath: string;
  }): ChatRecord {
    const id = randomUUID();
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO chats (id, project_id, task_id, agent, title, log_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.taskId ?? null,
        input.agent,
        input.title,
        input.logPath,
        now,
        now,
      );
    return this.getChat(id)!;
  }

  getChat(id: string): ChatRecord | undefined {
    const row = this.db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as Row | undefined;
    return row && toChat(row);
  }

  /** Chats of a project (or of one task), most recently active first. */
  listChats(
    projectId: string,
    options: { taskId?: string; archived?: boolean } = {},
  ): ChatRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM chats WHERE project_id = ? AND archived = ?
         AND (? IS NULL AND task_id IS NULL OR task_id = ?) ORDER BY updated_at DESC, rowid DESC`,
      )
      .all(
        projectId,
        options.archived ? 1 : 0,
        options.taskId ?? null,
        options.taskId ?? null,
      ) as Row[];
    return rows.map(toChat);
  }

  /** The agent of a chat never changes (D-24): only title, archive flag and session. */
  updateChat(
    id: string,
    patch: { title?: string; archived?: boolean; nativeSessionId?: string },
  ): void {
    const chat = this.getChat(id);
    if (!chat) throw new Error(`chat ${id} not found`);
    this.db
      .prepare(
        'UPDATE chats SET title = ?, archived = ?, native_session_id = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        patch.title ?? chat.title,
        (patch.archived ?? chat.archived) ? 1 : 0,
        patch.nativeSessionId ?? chat.nativeSessionId ?? null,
        this.now(),
        id,
      );
  }

  // ── merges ───────────────────────────────────────────────────────────────

  recordMerge(input: Omit<MergeRecord, 'id' | 'mergedAt' | 'revertCommit'>): MergeRecord {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO merges (id, project_id, task_id, branch, merge_commit, strategy, merged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.taskId,
        input.branch,
        input.commit,
        input.strategy,
        this.now(),
      );
    return this.listMerges(input.projectId, input.taskId).find((m) => m.id === id)!;
  }

  markMergeReverted(id: string, revertCommit: string): void {
    this.db.prepare('UPDATE merges SET revert_commit = ? WHERE id = ?').run(revertCommit, id);
  }

  /** Newest first. */
  listMerges(projectId: string, taskId?: string): MergeRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM merges WHERE project_id = ? AND (? IS NULL OR task_id = ?) ORDER BY merged_at DESC, rowid DESC`,
      )
      .all(projectId, taskId ?? null, taskId ?? null) as Row[];
    return rows.map((r) => ({
      id: String(r['id']),
      projectId: String(r['project_id']),
      taskId: String(r['task_id']),
      branch: String(r['branch']),
      commit: String(r['merge_commit']),
      strategy: r['strategy'] as MergeRecord['strategy'],
      mergedAt: Number(r['merged_at']),
      revertCommit: opt(r['revert_commit']),
    }));
  }

  // ── interactions ─────────────────────────────────────────────────────────

  openInteraction(input: Omit<InteractionRecord, 'openedAt' | 'closedAt' | 'resolution'>): void {
    this.db
      .prepare(
        `INSERT INTO interactions (id, project_id, run_id, chat_id, kind, payload, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.runId ?? null,
        input.chatId ?? null,
        input.kind,
        JSON.stringify(input.payload),
        this.now(),
      );
  }

  closeInteraction(id: string, resolution: string): void {
    this.db
      .prepare('UPDATE interactions SET closed_at = ?, resolution = ? WHERE id = ?')
      .run(this.now(), resolution, id);
  }

  listOpenInteractions(projectId?: string): InteractionRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM interactions WHERE closed_at IS NULL AND (? IS NULL OR project_id = ?) ORDER BY opened_at',
      )
      .all(projectId ?? null, projectId ?? null) as Row[];
    return rows.map((r) => ({
      id: String(r['id']),
      projectId: String(r['project_id']),
      runId: opt(r['run_id']),
      chatId: opt(r['chat_id']),
      kind: String(r['kind']),
      payload: JSON.parse(String(r['payload'])) as unknown,
      openedAt: Number(r['opened_at']),
    }));
  }

  private transaction(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function opt(value: SQLInputValue | undefined): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function toProject(r: Row): ProjectRecord {
  return {
    id: String(r['id']),
    name: String(r['name']),
    path: String(r['path']),
    createdAt: Number(r['created_at']),
    lastOpenedAt: r['last_opened_at'] === null ? undefined : Number(r['last_opened_at']),
  };
}

function toRun(r: Row): RunRecord {
  return {
    id: String(r['id']),
    projectId: String(r['project_id']),
    taskId: String(r['task_id']),
    agent: String(r['agent']),
    model: opt(r['model']),
    worktree: opt(r['worktree']),
    branch: opt(r['branch']),
    logPath: String(r['log_path']),
    adapterVersion: String(r['adapter_version']),
    nativeSessionId: opt(r['native_session_id']),
    startedAt: Number(r['started_at']),
    endedAt: r['ended_at'] === null ? undefined : Number(r['ended_at']),
    outcome: opt(r['outcome']) as RunOutcome | undefined,
  };
}

function toChat(r: Row): ChatRecord {
  return {
    id: String(r['id']),
    projectId: String(r['project_id']),
    taskId: opt(r['task_id']),
    agent: String(r['agent']),
    title: String(r['title']),
    nativeSessionId: opt(r['native_session_id']),
    logPath: String(r['log_path']),
    archived: r['archived'] === 1,
    createdAt: Number(r['created_at']),
    updatedAt: Number(r['updated_at']),
  };
}
