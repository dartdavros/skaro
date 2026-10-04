import { DbTable } from './table.ts';
import type { MergeRecord } from './model.ts';
import { type Row, opt } from './rows.ts';
import { randomUUID } from 'node:crypto';

export class DbMerges extends DbTable {
  // ── merges ───────────────────────────────────────────────────────────────

  recordMerge(input: Omit<MergeRecord, 'id' | 'mergedAt' | 'revertCommit'>): MergeRecord {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO merges (id, project_id, task_id, branch, merge_commit, strategy, merged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.taskId,
        input.branch,
        input.commit,
        input.strategy,
        this.now(),
      );
    return this.listMerges(input.projectId, input.taskId).find((m) => m.id === id)!;
  }

  markMergeReverted(id: string, revertCommit: string): void {
    this.db.prepare('UPDATE merges SET revert_commit = ? WHERE id = ?').run(revertCommit, id);
  }

  /** Newest first. */
  listMerges(projectId: string, taskId?: string): MergeRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM merges WHERE project_id = ? AND (? IS NULL OR task_id = ?) ORDER BY merged_at DESC, rowid DESC`,
      )
      .all(projectId, taskId ?? null, taskId ?? null) as Row[];
    return rows.map((r) => ({
      id: String(r['id']),
      projectId: String(r['project_id']),
      taskId: String(r['task_id']),
      branch: String(r['branch']),
      commit: String(r['merge_commit']),
      strategy: r['strategy'] as MergeRecord['strategy'],
      mergedAt: Number(r['merged_at']),
      revertCommit: opt(r['revert_commit']),
    }));
  }
}
