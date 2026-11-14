import {
  incidentHash,
  remedyKey,
  type AppDb,
  type CoordinationBlocker,
  type RemedyAction,
} from '@skaro/core';

/** Renewal has a new identity; repeated reads of the current unexpired request stay idempotent. */
export function incidentRequestIdentity(
  db: AppDb,
  row: CoordinationBlocker,
  action: RemedyAction,
  policyRevision: number,
): string {
  const base = incidentHash([row.id, remedyKey(action), policyRevision]);
  const previous =
    row.protocol!.decisionId &&
    db.coordination.decisions.get(row.projectId, row.protocol!.decisionId);
  if (!previous || !['pending', 'cancelled'].includes(previous.state)) return base;
  const request = db.getSetting<{ policyRevision: number; expiresAt: number } | undefined>(
    `coordination.decision-action.${previous.id}`,
    undefined,
  );
  if (
    previous.state === 'pending' &&
    previous.inputHash === remedyKey(action) &&
    request?.policyRevision === policyRevision &&
    request.expiresAt > Date.now()
  )
    return previous.id;
  return incidentHash([
    row.id,
    remedyKey(action),
    policyRevision,
    previous.id,
    previous.revision,
    request?.expiresAt,
  ]);
}
