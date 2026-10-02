import type { DatabaseSync } from 'node:sqlite';

/** Shared connection, clock and transaction boundary; no table-specific behavior. */
export class DbTable {
  protected readonly db: DatabaseSync;
  protected readonly now: () => number;
  constructor(db: DatabaseSync, now: () => number) {
    this.db = db;
    this.now = now;
  }
  protected transaction(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
