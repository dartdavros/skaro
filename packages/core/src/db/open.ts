import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations.ts';
import { requireSupportedSchema } from './schema-version.ts';

/** Schema migration is explicit on writable open; inspecting a profile never upgrades it. */
export function openDatabase(path: string, readOnly = false): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly });
  try {
    const version = Number(
      (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    );
    requireSupportedSchema(version, MIGRATIONS.length);
    if (readOnly) {
      db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000;');
      return db;
    }
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout=5000;');
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
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
