import { DbTable } from './table.ts';
import type { TaskRuntime } from '../status.ts';
import { type Row, opt } from './rows.ts';
export type StaleTaskRuntime = { projectId: string; taskId: string; state: TaskRuntime };

export class DbRuntime extends DbTable {
  counts(): Record<TaskRuntime, number> {
    const counts = { idle: 0, queued: 0, running: 0, waiting: 0, failed: 0 };
    const rows = this.db
      .prepare('SELECT state, COUNT(*) AS count FROM task_runtime GROUP BY state')
      .all();
    for (const row of rows) counts[row['state'] as TaskRuntime] = Number(row['count']);
    return counts;
  }

  // ── runtime task state ───────────────────────────────────────────────────

  setTaskRuntime(projectId: string, taskId: string, state: TaskRuntime, runId?: string): void {
    if (state === 'idle') {
      this.db
        .prepare('DELETE FROM task_runtime WHERE project_id = ? AND task_id = ?')
        .run(projectId, taskId);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO task_runtime (project_id, task_id, state, run_id, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, task_id) DO UPDATE SET state = excluded.state, run_id = excluded.run_id, updated_at = excluded.updated_at`,
      )
      .run(projectId, taskId, state, runId ?? null, this.now());
  }

  getTaskRuntime(projectId: string): Map<string, { state: TaskRuntime; runId?: string }> {
    const rows = this.db
      .prepare('SELECT * FROM task_runtime WHERE project_id = ?')
      .all(projectId) as Row[];
    return new Map(
      rows.map((r) => [
        String(r['task_id']),
        { state: r['state'] as TaskRuntime, runId: opt(r['run_id']) },
      ]),
    );
  }

  /**
   * After a restart no agent process is alive: running and queued tasks become idle.
   * Waiting tasks keep their state — their open interactions are shown again (agent-output.md, 6).
   */
  resetStaleRuntime(projectId?: string): StaleTaskRuntime[] {
    const condition = `state IN ('running', 'queued')${projectId ? ' AND project_id=?' : ''}`;
    const args = projectId ? [projectId] : [];
    const rows = this.db
      .prepare(`SELECT * FROM task_runtime WHERE ${condition}`)
      .all(...args) as Row[];
    this.db.prepare(`DELETE FROM task_runtime WHERE ${condition}`).run(...args);
    return rows.map((r) => ({
      projectId: String(r['project_id']),
      taskId: String(r['task_id']),
      state: r['state'] as TaskRuntime,
    }));
  }
}
