import {
  remedyKey,
  type AppDb,
  type RemedyAction,
  type RemedyApproval,
  type RemedyPolicy,
} from '@skaro/core';

/** This permits a fresh question only, never replay of consumed consent or an unknown effect. */
export function canRenewIncidentApproval(
  db: AppDb,
  action: RemedyAction,
  policy: RemedyPolicy,
  approval: RemedyApproval | undefined,
  now = Date.now(),
): boolean {
  const hash = remedyKey(action);
  if (
    !['environment.start', 'inputs.recheck'].includes(action.kind) ||
    approval?.author !== 'owner' ||
    approval.decision !== 'allow' ||
    !approval.consumed ||
    approval.revoked ||
    approval.action !== hash ||
    approval.policyRevision !== policy.revision ||
    now >= policy.expiresAt ||
    policy.denied.some((r) => r.kind === action.kind && r.target === action.target) ||
    action.costUsd === null ||
    !Number.isFinite(action.costUsd) ||
    action.costUsd < 0
  )
    return false;
  const row = db.coordination.blockers.get(action.projectId, action.incidentId);
  if (row?.state !== 'open' || !row.protocol?.operationId || row.protocol.attempts >= 2)
    return false;
  const operation = db.coordination.getOperation(action.projectId, row.protocol.operationId);
  return (
    !!operation &&
    operation.state === 'failed' &&
    operation.action === 'incident.remedy' &&
    operation.inputHash === hash &&
    [
      'environment_not_dispatched_before_admission',
      'environment_start_failed_partial_effects_possible',
    ].includes(operation.evidence?.code ?? '')
  );
}
