import type { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { checkIncident, currentIncidentSubscriber } from './incident-condition';
import { checkoutKey } from './task-stage';
import { resourceExecution } from './resource-execution';

/** A tool-confirmed launch lets this same turn continue without a second recovery message. */
export async function confirmTaskEnvironmentRepair(ctx: TaskRunEngine, active: ActiveRun) {
  const { projectId, run } = active;
  if (!ctx.deps.coordinators) return;
  const execution = ctx.continuation.execution(active);
  const id = execution.read().blockedIncident;
  if (!id) return;
  const row = ctx.deps.db.coordination.blockers.get(projectId, id);
  if (
    row?.state !== 'open' ||
    row.subject.kind !== 'resource' ||
    row.protocol?.condition !== 'environment-ready'
  )
    return;
  const subscription = row.protocol.subscriptions.find(
    (s) =>
      s.runId === run.id && s.taskId === active.taskId && s.intent === execution.intentVersion(),
  );
  if (!subscription) return;
  const resource = await ctx.environments.incidentResource(checkoutKey(active));
  if (
    resource?.id !== row.subject.id ||
    !(await checkIncident(ctx, row)) ||
    !(await currentIncidentSubscriber(ctx, projectId, subscription))
  )
    return;
  await resourceExecution.getStore()?.requireCurrent();
  if (ctx.deps.db.coordination.blockers.get(projectId, id)?.revision !== row.revision) return;
  await ctx.incidents.resolved(row, { runId: run.id, intent: subscription.intent });
}
