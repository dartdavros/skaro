export const MIGRATIONS: string[] = [
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
  // 2: what happened in a project, for "Недавние события" of the overview.
  `
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    data TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX events_project ON events(project_id, at);
  `,
  // 3: the project's logo ("Параметры проекта").
  `
  ALTER TABLE projects ADD COLUMN logo TEXT;
  `,
];
