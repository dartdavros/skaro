import { CHAT_CATALOG_MIGRATION } from './chat-catalog-migration.ts';
import { RESOURCE_MIGRATION } from './resource-migration.ts';
import { COORDINATION_MIGRATION } from './coordination-migration.ts';
import { ADMISSION_MIGRATION } from './admission-migration.ts';
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
  `
  ALTER TABLE runs ADD COLUMN previous_run_id TEXT REFERENCES runs(id);
  ALTER TABLE runs ADD COLUMN handoff TEXT;
  CREATE UNIQUE INDEX runs_continuation ON runs(previous_run_id) WHERE previous_run_id IS NOT NULL;
  `,
  // 5: a deleted task's retained history must not become a replacement task's session.
  `
  ALTER TABLE runs ADD COLUMN retired_at INTEGER;
  UPDATE runs SET retired_at = (
    SELECT MIN(events.at) FROM events
    WHERE events.project_id = runs.project_id AND events.kind = 'task_deleted'
      AND json_extract(events.data, '$.task') = runs.task_id AND events.at >= runs.started_at
  );
  UPDATE runs SET ended_at = COALESCE(ended_at, retired_at), outcome = COALESCE(outcome, 'interrupted')
    WHERE retired_at IS NOT NULL;
  DELETE FROM task_runtime WHERE run_id IN (SELECT id FROM runs WHERE retired_at IS NOT NULL);
  `,
  `CREATE TABLE owner_commands (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, method TEXT NOT NULL, args TEXT NOT NULL,
    state TEXT NOT NULL, error TEXT, updated_at INTEGER NOT NULL
  );
  CREATE INDEX owner_commands_pending ON owner_commands(state, updated_at);`,
  `CREATE TABLE collection_records (collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY(collection,id));
   CREATE TABLE collection_migrations (key TEXT PRIMARY KEY);`,
  CHAT_CATALOG_MIGRATION,
  RESOURCE_MIGRATION,
  COORDINATION_MIGRATION,
  ADMISSION_MIGRATION,
];
