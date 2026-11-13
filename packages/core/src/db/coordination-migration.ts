/** Durable controller metadata. No project-delete cascade may erase an uncertain effect. */
export const COORDINATION_MIGRATION = `
CREATE TABLE project_coordinators (
  project_id TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, version INTEGER NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE coordination_events (
  project_id TEXT NOT NULL REFERENCES project_coordinators(project_id), id TEXT NOT NULL,
  value TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(project_id,id)
);
CREATE TABLE coordination_intents (
  project_id TEXT NOT NULL REFERENCES project_coordinators(project_id), id TEXT NOT NULL,
  value TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(project_id,id)
);
CREATE TABLE coordination_operations (
  project_id TEXT NOT NULL REFERENCES project_coordinators(project_id), id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, event_id TEXT NOT NULL, intent_id TEXT NOT NULL,
  scope_key TEXT NOT NULL, value TEXT NOT NULL,
  revision INTEGER NOT NULL, state TEXT NOT NULL, claim_id TEXT, evidence TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY(project_id,id), UNIQUE(project_id,idempotency_key),
  UNIQUE(project_id,event_id), UNIQUE(project_id,intent_id),
  FOREIGN KEY(project_id,event_id) REFERENCES coordination_events(project_id,id),
  FOREIGN KEY(project_id,intent_id) REFERENCES coordination_intents(project_id,id)
);
CREATE INDEX coordination_pending ON coordination_operations(project_id,state,created_at);
CREATE UNIQUE INDEX coordination_scope_owner ON coordination_operations(project_id,scope_key)
  WHERE state IN ('dispatching','uncertain');
CREATE TABLE coordination_entities (
  project_id TEXT NOT NULL REFERENCES project_coordinators(project_id), id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('decision','blocker')), value TEXT NOT NULL,
  revision INTEGER NOT NULL, state TEXT NOT NULL, evidence TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY(project_id,kind,id)
);
CREATE INDEX coordination_entities_state ON coordination_entities(project_id,kind,state);
`;
