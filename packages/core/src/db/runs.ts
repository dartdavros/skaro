import { DbTable } from './table.ts';
import type { RunOutcome, RunRecord } from './model.ts';
import { type Row, toRun } from './rows.ts';
import { randomUUID } from 'node:crypto';

export class DbRuns extends DbTable {
  clearHistory(id: string, logPath: string, integrations: string[]): void {
    const run = this.getRun(id);
    if (!run) throw new Error('The run is not found');
    this.transaction(() => {
      this.db
        .prepare(
          'UPDATE runs SET log_path=?,native_session_id=NULL,previous_run_id=NULL,handoff=NULL WHERE id=?',
        )
        .run(logPath, id);
      this.db
        .prepare('DELETE FROM owner_commands WHERE owner=?')
        .run(`${run.projectId}:${run.taskId}`);
      this.db.prepare('DELETE FROM settings WHERE key=?').run(`question.answers.active.${id}`);
      this.db
        .prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)')
        .run(
          `task.${run.projectId}.${run.taskId}.clearedIntegrations`,
          JSON.stringify(integrations),
        );
    });
  }
  // ── runs ─────────────────────────────────────────────────────────────────

  createRun(
    input: Omit<RunRecord, 'id' | 'startedAt' | 'endedAt' | 'outcome' | 'nativeSessionId'>,
  ): RunRecord {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO runs (id, project_id, task_id, agent, model, worktree, branch, log_path, adapter_version, started_at, previous_run_id, handoff)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.taskId,
        input.agent,
        input.model ?? null,
        input.worktree ?? null,
        input.branch ?? null,
        input.logPath,
        input.adapterVersion,
        this.now(),
        input.previousRunId ?? null,
        input.handoff ?? null,
      );
    return this.getRun(id)!;
  }

  /** Publishes the successor and its synchronous state writes on this connection atomically. */
  continueRun(
    input: Parameters<DbRuns['createRun']>[0] & { previousRunId: string },
    settingsKey: string,
    settings: unknown,
    publishState?: (run: RunRecord) => undefined,
  ): RunRecord {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.getRun(input.previousRunId);
      if (
        !previous ||
        previous.retiredAt !== undefined ||
        previous.projectId !== input.projectId ||
        previous.taskId !== input.taskId
      )
        throw new Error('The previous run does not belong to this task');
      const latest = this.listRuns(input.projectId, input.taskId)[0];
      if (latest?.id !== previous.id) throw new Error('The task already has another run');
      const next = this.createRun(input);
      if (!previous.endedAt) this.finishRun(previous.id, 'interrupted');
      this.db
        .prepare(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        )
        .run(settingsKey, JSON.stringify(settings));
      publishState?.(next);
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(`${settingsKey}.handoff`);
      this.db.exec('COMMIT');
      return next;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  latest(projectId: string, taskId: string): RunRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM runs WHERE project_id=? AND task_id=? AND retired_at IS NULL
      ORDER BY started_at DESC,rowid DESC LIMIT 1`,
      )
      .get(projectId, taskId) as Row | undefined;
    return row ? toRun(row) : undefined;
  }

  getRun(id: string): RunRecord | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined;
    return row && toRun(row);
  }

  setRunSession(id: string, nativeSessionId: string): void {
    this.db.prepare('UPDATE runs SET native_session_id = ? WHERE id = ?').run(nativeSessionId, id);
  }

  finishRun(id: string, outcome: RunOutcome): void {
    this.db
      .prepare('UPDATE runs SET ended_at = ?, outcome = ? WHERE id = ?')
      .run(this.now(), outcome, id);
  }

  /** Newest first. */
  listRuns(
    projectId: string,
    taskId?: string,
    options: { includeRetired?: boolean } = {},
  ): RunRecord[] {
    const activeOnly = options.includeRetired ? '' : ' AND retired_at IS NULL';
    const rows = (
      taskId
        ? this.db
            .prepare(
              `SELECT * FROM runs WHERE project_id = ? AND task_id = ?${activeOnly} ORDER BY started_at DESC, rowid DESC`,
            )
            .all(projectId, taskId)
        : this.db
            .prepare(
              `SELECT * FROM runs WHERE project_id = ?${activeOnly} ORDER BY started_at DESC, rowid DESC`,
            )
            .all(projectId)
    ) as Row[];
    return rows.map(toRun);
  }

  retireTaskRuns(projectId: string, taskId: string): void {
    const at = this.now();
    this.db
      .prepare(
        `UPDATE runs SET retired_at = ?, ended_at = COALESCE(ended_at, ?), outcome = COALESCE(outcome, 'interrupted')
      WHERE project_id = ? AND task_id = ? AND retired_at IS NULL`,
      )
      .run(at, at, projectId, taskId);
  }

  /** Includes removed artifacts and retired runs when allocating new task numbers. */
  usedTaskIds(projectId: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT task_id AS id FROM runs WHERE project_id = ?
      UNION SELECT json_extract(data, '$.task') AS id FROM events
      WHERE project_id = ? AND kind = 'task_deleted'`,
        )
        .all(projectId, projectId) as Row[]
    )
      .map((row) => String(row['id']))
      .filter((id) => /^T-\d+$/.test(id));
  }
}
