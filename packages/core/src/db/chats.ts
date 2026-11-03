import { DbTable } from './table.ts';
import type { ChatRecord } from './model.ts';
import { type Row, toChat } from './rows.ts';
import { randomUUID } from 'node:crypto';

export class DbChats extends DbTable {
  /** Publish a stopped builtin chat's next native journal and settings as one transaction. */
  rebind(id: string, expected: string, next: string, commit: () => void): void {
    this.transaction(() => {
      const chat = this.getChat(id);
      if (
        !chat ||
        chat.agent !== 'skaro' ||
        chat.archived ||
        chat.nativeSessionId !== expected ||
        !next ||
        next === expected
      )
        throw new Error('Chat changed before builtin rebind');
      this.updateChat(id, { nativeSessionId: next });
      commit();
    });
  }
  /** Reset conversation storage only; project files and task/runtime records are untouched. */
  clearHistory(id: string, logPath: string): void {
    const chat = this.getChat(id);
    if (!chat) throw new Error(`chat ${id} not found`);
    this.transaction(() => {
      this.db
        .prepare('UPDATE chats SET log_path=?,native_session_id=NULL,updated_at=? WHERE id=?')
        .run(logPath, this.now(), id);
      this.db.prepare('DELETE FROM owner_commands WHERE owner=?').run(`${chat.projectId}:${id}`);
      const remove = this.db.prepare('DELETE FROM settings WHERE key=?');
      for (const key of [
        `chat.plan-decisions.${id}`,
        `chat.${id}.notes`,
        `chat.planning.${id}`,
        `question.answers.live.${id}`,
      ])
        remove.run(key);
      this.db
        .prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)')
        .run(`chat.${id}.clearedAt`, JSON.stringify(this.now()));
    });
  }
  // ── chats ────────────────────────────────────────────────────────────────

  createChat(input: {
    projectId: string;
    taskId?: string;
    agent: string;
    title: string;
    logPath: string;
  }): ChatRecord {
    const id = randomUUID();
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO chats (id, project_id, task_id, agent, title, log_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.taskId ?? null,
        input.agent,
        input.title,
        input.logPath,
        now,
        now,
      );
    return this.getChat(id)!;
  }

  getChat(id: string): ChatRecord | undefined {
    const row = this.db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as Row | undefined;
    return row && toChat(row);
  }

  /** Chats of a project (or of one task), most recently active first. */
  listChats(
    projectId: string,
    options: { taskId?: string; archived?: boolean } = {},
  ): ChatRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM chats WHERE project_id = ? AND archived = ?
         AND (? IS NULL AND task_id IS NULL OR task_id = ?) ORDER BY updated_at DESC, rowid DESC`,
      )
      .all(
        projectId,
        options.archived ? 1 : 0,
        options.taskId ?? null,
        options.taskId ?? null,
      ) as Row[];
    return rows.map(toChat);
  }

  /** The agent of a chat never changes (D-24): only title, archive flag and session. */
  updateChat(
    id: string,
    patch: { title?: string; archived?: boolean; nativeSessionId?: string },
  ): void {
    const chat = this.getChat(id);
    if (!chat) throw new Error(`chat ${id} not found`);
    this.db
      .prepare(
        'UPDATE chats SET title = ?, archived = ?, native_session_id = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        patch.title ?? chat.title,
        (patch.archived ?? chat.archived) ? 1 : 0,
        patch.nativeSessionId ?? chat.nativeSessionId ?? null,
        this.now(),
        id,
      );
  }
}
