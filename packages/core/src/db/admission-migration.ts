export const ADMISSION_MIGRATION = `
CREATE TABLE resource_leases (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL, value TEXT NOT NULL
);
CREATE INDEX resource_lease_project ON resource_leases(project_id);
`;
