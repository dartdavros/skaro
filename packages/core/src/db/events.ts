import { DbTable } from './table.ts';
import type { EventRecord } from './model.ts';
import { type Row } from './rows.ts';

export class DbEvents extends DbTable {
  // ── events ───────────────────────────────────────────────────────────────

  addEvent(projectId: string, kind: string, data: Record<string, unknown> = {}): void {
    this.db
      .prepare('INSERT INTO events (project_id, kind, data, at) VALUES (?, ?, ?, ?)')
      .run(projectId, kind, JSON.stringify(data), this.now());
  }

  /** Latest events first. */
  listEvents(projectId: string, limit = 20): EventRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE project_id = ? ORDER BY at DESC, id DESC LIMIT ?')
      .all(projectId, limit) as Row[];
    return rows.map((r) => ({
      id: Number(r['id']),
      projectId: String(r['project_id']),
      kind: String(r['kind']),
      data: JSON.parse(String(r['data'])) as Record<string, unknown>,
      at: Number(r['at']),
    }));
  }
}
