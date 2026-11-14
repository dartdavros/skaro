import { incidentHash, type CoordinationBlocker, type IncidentSubscription } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import type { TaskIncidents } from './task-incidents';
import { incidentResourceVersion } from './incident-condition';
import { cancelIncidentApproval } from './incident-feed';

/** Replace obsolete configuration authority; old consent never authorizes the new configuration. */
export async function refreshIncidentContext(
  ctx: TaskRunEngine,
  incidents: TaskIncidents,
  row: CoordinationBlocker,
  subscribers: IncidentSubscription[],
): Promise<boolean> {
  if (row.subject.kind !== 'resource' || row.protocol!.condition !== 'environment-ready')
    return false;
  const version = await incidentResourceVersion(ctx, row.projectId, row.subject.id);
  if (version === row.protocol!.resourceVersion) return false;
  const operation =
    row.protocol!.operationId &&
    ctx.deps.db.coordination.getOperation(row.projectId, row.protocol!.operationId);
  if (operation && ['dispatching', 'uncertain'].includes(operation.state)) return false;
  let replacement: CoordinationBlocker | undefined;
  for (const subscriber of subscribers) {
    const active = await ctx.history.restore(row.projectId, subscriber.taskId);
    if (!active || active.run.id !== subscriber.runId) continue;
    replacement = await incidents.report(
      active,
      row.protocol!.code,
      {
        cause: row.protocol!.cause,
        code: row.protocol!.code,
        condition: 'environment-ready',
        resourceId: row.subject.id,
      },
      'controller',
    );
  }
  if (!replacement || replacement.id === row.id) return false;
  const current = incidents.store.get(row.projectId, row.id);
  if (current.state !== 'open') return true;
  ctx.deps.db.coordination.blockers.transition(row.projectId, row.id, {
    expectedRevision: current.revision,
    state: 'cancelled',
    evidence: {
      code: 'incident_configuration_superseded',
      refs: [replacement.subject],
      fingerprint: incidentHash([row.id, replacement.id]),
    },
  });
  if (current.protocol!.decisionId)
    await cancelIncidentApproval(
      ctx,
      current,
      current.protocol!.decisionId,
      'incident_configuration_superseded',
    );
  await incidents.reconcile(row.projectId, replacement.id);
  return true;
}
