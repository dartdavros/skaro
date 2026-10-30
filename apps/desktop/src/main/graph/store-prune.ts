import type { DatabaseSync } from 'node:sqlite';
import { setTimeout } from 'node:timers/promises';

const BATCH = 5000;

/**
 * Expire metadata first, then remove every row of the expired snapshots. Each published index
 * adds a whole snapshot, so cleanup must finish rather than stop on a time budget: a bounded
 * trickle fell behind and kept discarded snapshots in the file. Batches yield to reads in WAL mode;
 * an interrupted run resumes from the garbage journal, and freed pages are reused by the next index.
 */
export async function pruneSnapshots(
  db: DatabaseSync,
  retained: (string | undefined)[],
): Promise<void> {
  db.exec('BEGIN IMMEDIATE');
  try {
    const expired = (db.prepare('SELECT id FROM snapshots').all() as { id: string }[]).filter(
      ({ id }) => !retained.includes(id),
    );
    for (const { id } of expired) {
      db.prepare('INSERT OR IGNORE INTO garbage VALUES(?)').run(id);
      db.prepare('DELETE FROM snapshots WHERE id=?').run(id);
      db.prepare('DELETE FROM metadata WHERE key IN (?,?)').run(`model:${id}`, `overview:${id}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const garbage = (db.prepare('SELECT snapshot FROM garbage').all() as { snapshot: string }[]).map(
    ({ snapshot }) => snapshot,
  );
  if (!garbage.length) return;
  for (const table of ['nodes', 'edges', 'unresolved']) {
    // Each of these tables leads an index with its snapshot column: a batch reads only its rows.
    const remove = db.prepare(`DELETE FROM ${table} WHERE rowid IN
      (SELECT rowid FROM ${table} WHERE snapshot=? LIMIT ${BATCH})`);
    for (const snapshot of garbage) while (remove.run(snapshot).changes) await setTimeout(10);
  }
  // The full-text table cannot index its snapshot column: one pass removes all expired rows.
  db.prepare(`DELETE FROM search WHERE snapshot IN (${garbage.map(() => '?').join(',')})`).run(
    ...garbage,
  );
  for (const snapshot of garbage) db.prepare('DELETE FROM garbage WHERE snapshot=?').run(snapshot);
}
