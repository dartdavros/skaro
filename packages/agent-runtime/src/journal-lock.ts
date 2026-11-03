import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { RuntimeProcessIdentity } from '@skaro/timeline';
import { processBirth } from './process-identity.ts';

/** SQLite holds only ownership/checkpoint projections, never a second history of facts. */
export class JournalLock {
  private readonly db: DatabaseSync;
  private readonly token = randomUUID();
  private constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS owner (singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        token TEXT NOT NULL, pid INTEGER NOT NULL, birth TEXT NOT NULL, platform TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS checkpoint (singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        sequence INTEGER NOT NULL, hash TEXT NOT NULL, state TEXT NOT NULL);`);
  }

  static async acquire(path: string, owner: RuntimeProcessIdentity): Promise<JournalLock> {
    const lock = new JournalLock(path);
    try {
      if (
        owner.pid !== process.pid ||
        owner.platform !== process.platform ||
        (await processBirth(owner.pid)) !== owner.birth
      )
        throw new Error('Invalid runtime owner identity');
      lock.db.exec('BEGIN IMMEDIATE');
      const previous = lock.db.prepare('SELECT * FROM owner WHERE singleton=1').get() as
        { pid: number; birth: string; platform: string } | undefined;
      if (
        previous &&
        (previous.platform !== process.platform ||
          (await processBirth(previous.pid)) === previous.birth)
      )
        throw new Error('Session already has a live runtime owner');
      lock.db
        .prepare('INSERT OR REPLACE INTO owner VALUES (1,?,?,?,?)')
        .run(lock.token, owner.pid, owner.birth, owner.platform);
      lock.db.exec('COMMIT');
      return lock;
    } catch (error) {
      if (lock.db.isTransaction) lock.db.exec('ROLLBACK');
      lock.db.close();
      throw error;
    }
  }

  assertOwned(): void {
    const row = this.db.prepare('SELECT token FROM owner WHERE singleton=1').get();
    if (row?.['token'] !== this.token) throw new Error('Runtime journal ownership revoked');
  }

  checkpoint(sequence: number, hash: string, state: unknown): void {
    this.assertOwned();
    this.db
      .prepare('INSERT OR REPLACE INTO checkpoint VALUES (1,?,?,?)')
      .run(sequence, hash, JSON.stringify(state));
  }

  close(): void {
    this.db.prepare('DELETE FROM owner WHERE singleton=1 AND token=?').run(this.token);
    this.db.close();
  }
}
