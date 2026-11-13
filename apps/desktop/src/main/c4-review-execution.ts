import { randomUUID } from 'node:crypto';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import { C4SemanticStore, type C4SemanticJob } from './c4-semantic-store';
import { c4SemanticSnapshot } from './c4-semantic-snapshot';
import { requireCoordinationDispatch } from './coordination-dispatch';
import { resourcesFor } from './resource-execution';
import { c4Packages } from './c4-coordination-binding';
import { runSemanticC4Review } from './c4-semantic-runner';
import { deliverC4Review } from './c4-review-delivery';

/** Guards are re-read at resource admission, result persistence and outbox delivery. */
export function c4ReviewGuard(
  ctx: TaskRunEngine,
  job: C4SemanticJob,
  active: ActiveRun,
  signal: AbortSignal,
) {
  return async () => {
    signal.throwIfAborted();
    requireCoordinationDispatch(ctx.deps.db, job.projectId, job.dispatchRevision);
    const execution = ctx.continuation.execution(active);
    if (
      ctx.closing ||
      !execution.read().enabled ||
      execution.intentVersion() !== job.intent ||
      ctx.deps.db.latestRun(job.projectId, job.taskId)?.id !== job.runId
    )
      throw new Error('C4 review intent is no longer current');
    if (
      (
        await c4SemanticSnapshot(
          ctx.deps.db,
          ctx.project(job.projectId),
          job.taskId,
          job.runId,
          false,
        )
      ).fingerprint !== job.fingerprint
    )
      throw new Error('C4 review input fingerprint changed');
  };
}
export async function executeC4Review(
  ctx: TaskRunEngine,
  initial: C4SemanticJob,
  active: ActiveRun,
  signal: AbortSignal,
) {
  const db = ctx.deps.db,
    resources = resourcesFor(db),
    store = new C4SemanticStore(db);
  if (!resources || !ctx.deps.coordinators)
    throw new Error('C4 verification requires real coordinator/resource services');
  const fresh = c4ReviewGuard(ctx, initial, active, signal);
  await fresh();
  if (initial.state === 'verified') {
    await deliverC4Review(ctx, initial, fresh);
    return;
  }
  await ctx.deps.coordinators.execute(
    {
      id: `c4.semantic:${initial.id}`,
      projectId: initial.projectId,
      action: 'c4.semantic.review',
      source: { kind: 'controller', id: 'project-coordinator' },
      subject: { kind: 'run', id: initial.runId },
      scopeKey: `c4.review:${initial.runId}`,
      mode: 'control',
      inputHash: initial.fingerprint,
    },
    async () => {
      let job = store.update(initial, {
        state: 'running',
        worker: `c4-review-${initial.id}-${randomUUID()}`,
      });
      const snapshot = await c4SemanticSnapshot(
        db,
        ctx.project(job.projectId),
        job.taskId,
        job.runId,
        false,
      );
      const pkg = job.packageId
        ? await c4Packages(db)!.read(job.packageId, job.projectId)
        : undefined;
      const result = await resources.scope(
        job.projectId,
        `c4-review:${job.id}`,
        () =>
          runSemanticC4Review(
            ctx,
            job,
            snapshot,
            signal,
            fresh,
            pkg ? JSON.stringify(pkg) : undefined,
          ),
        { signal, intentId: job.id, dispatchRevision: job.dispatchRevision, requireCurrent: fresh },
      );
      await fresh();
      job = store.update(job, { state: 'verified', ...result });
      await deliverC4Review(ctx, job, fresh);
    },
    { validate: fresh, replay: () => undefined },
  );
}
