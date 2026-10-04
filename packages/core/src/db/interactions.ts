import { DbTable } from './table.ts';
import type { InteractionRecord } from './model.ts';
import { type Row, opt } from './rows.ts';

export class DbInteractions extends DbTable {
  // ── interactions ─────────────────────────────────────────────────────────

  openInteraction(input: Omit<InteractionRecord, 'openedAt' | 'closedAt' | 'resolution'>): void {
    this.db
      .prepare(
        `INSERT INTO interactions (id, project_id, run_id, chat_id, kind, payload, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.runId ?? null,
        input.chatId ?? null,
        input.kind,
        JSON.stringify(input.payload),
        this.now(),
      );
  }

  closeInteraction(id: string, resolution: string): void {
    this.db
      .prepare('UPDATE interactions SET closed_at = ?, resolution = ? WHERE id = ?')
      .run(this.now(), resolution, id);
  }

  listOpenInteractions(projectId?: string): InteractionRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM interactions WHERE closed_at IS NULL AND (? IS NULL OR project_id = ?) ORDER BY opened_at',
      )
      .all(projectId ?? null, projectId ?? null) as Row[];
    return rows.map((r) => ({
      id: String(r['id']),
      projectId: String(r['project_id']),
      runId: opt(r['run_id']),
      chatId: opt(r['chat_id']),
      kind: String(r['kind']),
      payload: JSON.parse(String(r['payload'])) as unknown,
      openedAt: Number(r['opened_at']),
    }));
  }
}
