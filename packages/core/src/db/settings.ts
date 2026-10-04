import { DbTable } from './table.ts';
import { type Row } from './rows.ts';

export class DbSettings extends DbTable {
  // ── settings ─────────────────────────────────────────────────────────────

  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      Row | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(String(row['value'])) as T;
    } catch {
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
}
