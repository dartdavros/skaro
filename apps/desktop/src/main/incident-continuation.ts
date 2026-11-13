import type { CoordinationBlocker } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { currentIncidentSubscriber } from './incident-condition';
import { commitIncidentDelivery } from './incident-delivery';
import { requireCoordinationDispatch } from './coordination-dispatch';
/** Clear the blocker and commit the original continuation to the one inbox atomically. */
export async function continueResolvedIncident(ctx: TaskRunEngine, row: CoordinationBlocker) {
  if (row.state !== 'resolved' || !row.protocol) return;
  for (const subscription of row.protocol.subscriptions) {
    if (!(await currentIncidentSubscriber(ctx, row.projectId, subscription))) continue;
    const active = await ctx.history.restore(row.projectId, subscription.taskId);
    if (!active || active.run.id !== subscription.runId) continue;
    const execution = ctx.continuation.execution(active);
    if (execution.read().blockedIncident !== row.id) continue;
    const remaining = ctx.incidents.store
      .list(row.projectId)
      .find(
        (b) =>
          b.state === 'open' &&
          b.protocol!.subscriptions.some(
            (s) => s.runId === subscription.runId && s.intent === subscription.intent,
          ),
      );
    if (remaining) {
      execution.block(remaining.protocol!.code, remaining.id);
      continue;
    }
    requireCoordinationDispatch(ctx.deps.db, row.projectId);
    commitIncidentDelivery(ctx.deps.db, row.projectId, row.id, row.subject.id, subscription);
  }
}
