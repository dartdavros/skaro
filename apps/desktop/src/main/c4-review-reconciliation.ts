import type { CoordinationOperation } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { C4SemanticStore, type C4SemanticJob } from './c4-semantic-store';
import { resourcesFor } from './resource-execution';

/** A failed read-only review is never replayed; only a new owner intent may replace it. */
export function failedReadonlyC4Review(
  op: CoordinationOperation,
  job: C4SemanticJob | undefined,
  project: string,
  run: string,
  intent: number,
): job is C4SemanticJob & { worker: string } {
  return (
    !!job &&
    op.projectId === project &&
    job.projectId === project &&
    op.action === 'c4.semantic.review' &&
    op.mode === 'control' &&
    op.state === 'uncertain' &&
    op.id === `c4.semantic:${job.id}` &&
    op.inputHash === job.fingerprint &&
    op.scopeKey === `c4.review:${run}` &&
    op.subject.kind === 'run' &&
    op.subject.id === run &&
    job.runId === run &&
    job.state === 'failed' &&
    job.intent < intent &&
    !!job.worker?.startsWith(`c4-review-${job.id}-`)
  );
}

/** Reconcile the old control journal only after the actual old reviewer has stopped. */
export async function reconcileFailedC4Reviews(
  ctx: TaskRunEngine,
  project: string,
  run: string,
  intent: number,
) {
  const db = ctx.deps.db,
    store = new C4SemanticStore(db);
  for (const op of db.coordination.pending(project)) {
    if (!op.id.startsWith('c4.semantic:')) continue;
    const job = store.get(op.id.slice('c4.semantic:'.length));
    if (!failedReadonlyC4Review(op, job, project, run, intent)) continue;
    await ctx.processes.stop(job.worker);
    const current = db.coordination.getOperation(project, op.id),
      latest = store.get(job.id);
    if (
      !current ||
      current.revision !== op.revision ||
      latest?.worker !== job.worker ||
      !failedReadonlyC4Review(current, latest, project, run, intent)
    )
      continue;
    resourcesFor(db)?.releaseOwner(
      project,
      `c4-review:${job.id}`,
      'readonly_reviewer_exit_confirmed',
    );
    ctx.deps.coordinators!.reconcile(
      project,
      op.id,
      {
        code: 'c4_readonly_reviewer_exit_confirmed',
        refs: [{ kind: 'run', id: run }],
      },
      'failed',
    );
  }
}
