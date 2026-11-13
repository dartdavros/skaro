import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { DbCoordination } from './coordination.ts';
import { MIGRATIONS } from './migrations.ts';
import { COORDINATION_MIGRATION } from './coordination-migration.ts';

it('keeps an older schema read-only and migrates its schema without inserting synthetic project records', () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const migration of MIGRATIONS.slice(0, MIGRATIONS.indexOf(COORDINATION_MIGRATION)))
      db.exec(migration);
    db.exec('PRAGMA query_only=ON');
    const ledger = new DbCoordination(db, Date.now);
    expect(ledger.pending(process.cwd())).toEqual([]);
    expect(ledger.get(process.cwd())).toBeUndefined();
    expect(ledger.decisions.list(process.cwd())).toEqual([]);
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE name='project_coordinators'").get(),
    ).toBeUndefined();
    db.exec('PRAGMA query_only=OFF');
    db.exec(COORDINATION_MIGRATION);
    expect(ledger.pending(process.cwd())).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM projects').get()?.count).toBe(0);
  } finally {
    db.close();
  }
});
