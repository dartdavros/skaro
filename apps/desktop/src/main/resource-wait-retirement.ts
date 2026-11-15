import type { CoordinationBlocker, CoordinationOperation, IncidentProtocol } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { cancelIncidentApproval } from './incident-feed';
import { continueResolvedIncident } from './incident-continuation';

/** An absent record or any live/unknown executor must finish reconciliation before policy retirement. */
export function capacityWaitRetirable(
  state: CoordinationBlocker['state'],
  protocol: Pick<IncidentProtocol, 'code' | 'phase' | 'operationId'> | undefined,
  operation?: Pick<CoordinationOperation, 'state'>,
) {
  return (
    state === 'open' &&
    protocol?.code === 'environment_waiting_resource' &&
    !['executing', 'verifying'].includes(protocol.phase) &&
    (!protocol.operationId ||
      (!!operation && !['queued', 'dispatching', 'uncertain'].includes(operation.state)))
  );
}

/** An obsolete capacity checkpoint is history, never a new permission or proof of readiness. */
export async function retireCapacityWait(ctx: TaskRunEngine, row: CoordinationBlocker) {
  const operation = row.protocol?.operationId
    ? ctx.deps.db.coordination.getOperation(row.projectId, row.protocol.operationId)
    : undefined;
  if (!capacityWaitRetirable(row.state, row.protocol, operation)) return false;
  const resolved = ctx.deps.db.coordination.blockers.transition(row.projectId, row.id, {
    expectedRevision: row.revision,
    state: 'resolved',
    evidence: { code: 'resource_capacity_admission_removed', refs: [row.subject] },
  });
  if (row.protocol!.decisionId)
    await cancelIncidentApproval(
      ctx,
      row,
      row.protocol!.decisionId,
      'resource_capacity_admission_removed',
    );
  await continueResolvedIncident(ctx, resolved);
  return true;
}
