/** No project FK cascade: forgetting a project must not erase ownership or cleanup evidence. */
export const RESOURCE_MIGRATION = `
CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  generation INTEGER NOT NULL CHECK(generation >= 1),
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX resources_project ON resources(project_id,id);
CREATE TABLE resource_outcomes (
  operation_id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id),
  generation INTEGER NOT NULL,
  value TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX resource_outcomes_resource ON resource_outcomes(resource_id,at);
`;
