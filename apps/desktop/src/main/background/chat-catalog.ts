import { requireAgentId } from '@skaro/agents';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { ChatRange, ChatCatalog, ChatPage } from '../../shared/chat-catalog';
import type { ChatSummary } from '../../shared/ipc-sessions';

/** Read canonical metadata through its covering order index; never load histories or all chats. */
export class ChatCatalogReader {
  private readonly db: DatabaseSync;
  constructor(dataDir: string) {
    this.db = new DatabaseSync(join(dataDir, 'skaro.db'), { readOnly: true });
    this.db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000');
  }
  private read<T>(action: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private counts(projectId: string) {
    const row = this.db
      .prepare('SELECT * FROM chat_catalog_counts WHERE project_id=?')
      .get(projectId);
    return {
      activeCount: Number(row?.['active'] ?? 0),
      archivedCount: Number(row?.['archived'] ?? 0),
      revision: Number(row?.['revision'] ?? 0),
    };
  }
  private range(projectId: string, archived: boolean): ChatRange {
    const counts = this.counts(projectId);
    return {
      projectId,
      archived,
      revision: counts.revision,
      count: archived ? counts.archivedCount : counts.activeCount,
    };
  }
  private rows(source: ChatRange, start: number): ChatPage {
    start = Math.max(0, Math.min(source.count, Math.floor(start) || 0));
    const chats = this.db
      .prepare(
        `SELECT c.id,c.title,c.agent,c.archived,c.updated_at,
      EXISTS(SELECT 1 FROM settings s WHERE s.key='import.'||c.id AND s.value<>'null') AS importing
      FROM chats c WHERE c.project_id=? AND c.archived=? AND c.task_id IS NULL
      ORDER BY c.updated_at DESC,c.rowid DESC LIMIT 16 OFFSET ?`,
      )
      .all(source.projectId, Number(source.archived), start)
      .map((row): ChatSummary => ({
        id: String(row['id']),
        title: String(row['title']),
        agent: requireAgentId(row['agent']),
        archived: Boolean(row['archived']),
        updatedAt: Number(row['updated_at']),
        live: false,
        ...(row['importing'] ? { kind: 'import' as const } : {}),
      }));
    return { source, start, chats };
  }
  query(projectId: string, archived: boolean): ChatCatalog {
    return this.read(() => {
      const source = this.range(projectId, archived);
      const counts = this.counts(projectId);
      const latest = this.db
        .prepare(
          `SELECT id FROM chats WHERE project_id=? AND archived=0
        AND task_id IS NULL ORDER BY updated_at DESC,rowid DESC LIMIT 1`,
        )
        .get(projectId)?.['id'];
      return { ...this.rows(source, 0), ...counts, ...(latest ? { latest: String(latest) } : {}) };
    });
  }
  page(source: ChatRange, start: number): ChatPage {
    return this.read(() => this.rows(this.range(source.projectId, source.archived), start));
  }
  find(source: ChatRange, id: string) {
    return this.read(() => {
      source = this.range(source.projectId, source.archived);
      const task = this.db
        .prepare(
          `SELECT rowid,updated_at FROM chats
        WHERE project_id=? AND archived=? AND task_id IS NULL AND id=?`,
        )
        .get(source.projectId, Number(source.archived), id);
      if (!task) return { source, index: -1 };
      const row = this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM chats WHERE project_id=? AND archived=?
        AND task_id IS NULL AND (updated_at>? OR (updated_at=? AND rowid>?))`,
        )
        .get(
          source.projectId,
          Number(source.archived),
          task['updated_at']!,
          task['updated_at']!,
          task['rowid']!,
        );
      return { source, index: Number(row?.['count'] ?? 0) };
    });
  }
  close(): void {
    this.db.close();
  }
}
