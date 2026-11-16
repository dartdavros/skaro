import type { RemedyAction } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import { checkoutKey } from './task-stage';
import { incidentResourceVersion } from './incident-condition';

/** The worker repair route cannot evade a coordinator denial or repeat an unknown start. */
export async function incidentStartProhibition(ctx: TaskRunEngine, active: ActiveRun) {
  const execution = ctx.continuation.execution(active).read();
  if (!execution.blockedIncident) return;
  const row = ctx.deps.db.coordination.blockers.get(active.projectId, execution.blockedIncident);
  if (!row?.protocol || row.state !== 'open') return;
  if (!execution.enabled) return 'The owner paused this task. No incident repair may restart it.';
  const operation =
    row.protocol.operationId &&
    ctx.deps.db.coordination.getOperation(active.projectId, row.protocol.operationId);
  if (operation && ['dispatching', 'uncertain'].includes(operation.state))
    return 'The earlier repair has an unknown outcome. Inspect and verify its actual result before any new start.';
  const resource = await ctx.environments.incidentResource(checkoutKey(active));
  if (!resource) return;
  const action: RemedyAction = {
    projectId: active.projectId,
    incidentId: row.id,
    kind: 'environment.start',
    target: resource.id,
    version: await incidentResourceVersion(ctx, active.projectId, resource.id),
    costUsd: 0,
  };
  if (ctx.incidents.policy.authority(action) === 'denied')
    return 'The current owner policy denies this recovery. Full worker access does not override that decision.';
}
