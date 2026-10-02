import { DbTable } from './table.ts';
import type { RunOutcome, RunRecord } from './model.ts';
import { type Row, toRun } from './rows.ts';
import { randomUUID } from 'node:crypto';

export class DbRuns extends DbTable {
  // ── runs ─────────────────────────────────────────────────────────────────

  createRun(
    input: Omit<RunRecord, 'id' | 'startedAt' | 'endedAt' | 'outcome' | 'nativeSessionId'>,
  ): RunRecord {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO runs (id, project_id, task_id, agent, model, worktree, branch, log_path, adapter_version, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
    return this.getRun(id)!;
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
  listRuns(projectId: string, taskId?: string): RunRecord[] {
    const rows = (
      taskId
        ? this.db
            .prepare(
              'SELECT * FROM runs WHERE project_id = ? AND task_id = ? ORDER BY started_at DESC, rowid DESC',
            )
            .all(projectId, taskId)
        : this.db
            .prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC, rowid DESC')
            .all(projectId)
    ) as Row[];
    return rows.map(toRun);
  }
}
