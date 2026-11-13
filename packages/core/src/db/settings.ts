import { DbTable } from './table.ts';
import { type Row } from './rows.ts';

export class DbSettings extends DbTable {
  /** Synchronous metadata writes on the shared connection, never external work or awaits. */
  atomic<T>(action: () => T): T {
    let result!: T;
    this.transaction(() => {
      result = action();
    });
    return result;
  }
  // ── settings ─────────────────────────────────────────────────────────────

  getSetting<T>(key: string, fallback: T, options: { strict?: boolean } = {}): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      Row | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(String(row['value'])) as T;
    } catch {
      if (options.strict) throw new Error('Stored setting contains invalid JSON');
      return fallback;
    }
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, JSON.stringify(value));
  }

  /** One SQLite mutation; undefined expected means absent, including under another writer. */
  compareAndSet(key: string, expected: unknown, value: unknown): boolean {
    const next = JSON.stringify(value);
    if (next === undefined) throw new Error('A setting must have a JSON value');
    if (expected === undefined)
      return (
        this.db
          .prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING')
          .run(key, next).changes === 1
      );
    return (
      this.db
        .prepare('UPDATE settings SET value=? WHERE key=? AND value=?')
        .run(next, key, JSON.stringify(expected)).changes === 1
    );
  }
}
