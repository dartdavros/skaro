/** Each element is ONE CREATE statement. Trigger bodies stay intact, never split at semicolons. */
/** No project foreign key: forgetting a project must NEVER cascade-delete its verification archive. */
export const VERIFICATION_ARCHIVE_SCHEMA: readonly string[] = Object.freeze([
  `CREATE TABLE IF NOT EXISTS verification_archive_headers (
  project_id TEXT NOT NULL, archive_id TEXT NOT NULL, subject_intent TEXT NOT NULL,
  manifest TEXT NOT NULL CHECK(typeof(manifest)='text'),
  manifest_digest TEXT NOT NULL, manifest_bytes INTEGER NOT NULL CHECK(manifest_bytes BETWEEN 1 AND 33554432),
  sealed INTEGER NOT NULL DEFAULT 0 CHECK(sealed IN (0,1)),
  PRIMARY KEY(project_id,archive_id,subject_intent)
) STRICT;`,
  `CREATE TABLE IF NOT EXISTS verification_archive_blobs (
  project_id TEXT NOT NULL, archive_id TEXT NOT NULL, subject_intent TEXT NOT NULL,
  digest TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes BETWEEN 0 AND 33554432),
  payload BLOB NOT NULL CHECK(length(payload)=bytes),
  PRIMARY KEY(project_id,archive_id,subject_intent,digest),
  FOREIGN KEY(project_id,archive_id,subject_intent)
    REFERENCES verification_archive_headers(project_id,archive_id,subject_intent)
) STRICT;`,
  `CREATE TRIGGER IF NOT EXISTS verification_archive_header_no_delete BEFORE DELETE ON verification_archive_headers
BEGIN SELECT RAISE(ABORT,'verification_archive_immutable'); END;`,
  `CREATE TRIGGER IF NOT EXISTS verification_archive_header_seal_only BEFORE UPDATE ON verification_archive_headers
WHEN OLD.sealed<>0 OR NEW.sealed<>1 OR OLD.project_id<>NEW.project_id OR OLD.archive_id<>NEW.archive_id
 OR OLD.subject_intent<>NEW.subject_intent OR OLD.manifest<>NEW.manifest
 OR OLD.manifest_digest<>NEW.manifest_digest OR OLD.manifest_bytes<>NEW.manifest_bytes
BEGIN SELECT RAISE(ABORT,'verification_archive_immutable'); END;`,
  `CREATE TRIGGER IF NOT EXISTS verification_archive_blob_no_update BEFORE UPDATE ON verification_archive_blobs
BEGIN SELECT RAISE(ABORT,'verification_archive_immutable'); END;`,
  `CREATE TRIGGER IF NOT EXISTS verification_archive_blob_no_delete BEFORE DELETE ON verification_archive_blobs
BEGIN SELECT RAISE(ABORT,'verification_archive_immutable'); END;`,
  `CREATE TRIGGER IF NOT EXISTS verification_archive_blob_open_only BEFORE INSERT ON verification_archive_blobs
WHEN NOT EXISTS (SELECT 1 FROM verification_archive_headers WHERE project_id=NEW.project_id
 AND archive_id=NEW.archive_id AND subject_intent=NEW.subject_intent AND sealed=0)
BEGIN SELECT RAISE(ABORT,'verification_archive_sealed_or_missing'); END;`,
]);
