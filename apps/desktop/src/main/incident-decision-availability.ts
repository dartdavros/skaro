import type { AppDb } from '@skaro/core';

/** Old feed logs can retain a card after its canonical decision was superseded or settled. */
export function retiredIncidentDecision(
  db: AppDb,
  projectId: string,
  id: string,
): 'answered' | 'cancelled' | undefined {
  const decision = db.coordination.decisions.get(projectId, id);
  if (!decision) return;
  if (decision.state === 'answered') return 'answered';
  if (decision.state !== 'pending') return 'cancelled';
  const incident = db.coordination.blockers.get(projectId, decision.subject.id);
  if (
    incident &&
    (incident.state !== 'open' ||
      (incident.protocol?.decisionId && incident.protocol.decisionId !== id))
  )
    return 'cancelled';
}

/** Owner questions carry no executable remedy and therefore need no action permission. */
export function incidentDecisionAvailability(
  db: AppDb,
  projectId: string,
  id: string,
  policyRevision: number,
): { expiresAt?: number } | undefined {
  const decision = db.coordination.decisions.get(projectId, id);
  if (decision?.state !== 'pending') return;
  const incident = db.coordination.blockers.get(projectId, decision.subject.id);
  if (incident?.state !== 'open' || incident.protocol?.decisionId !== id) return;
  if (decision.kind === 'question') return {};
  const request = db.getSetting<{ expiresAt: number; policyRevision: number } | undefined>(
    `coordination.decision-action.${id}`,
    undefined,
  );
  if (
    decision.kind === 'approval' &&
    request &&
    request.expiresAt > Date.now() &&
    request.policyRevision === policyRevision
  )
    return { expiresAt: request.expiresAt };
}
