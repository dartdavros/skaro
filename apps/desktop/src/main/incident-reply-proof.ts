import { remedyKey, type AppDb, type RemedyAction } from '@skaro/core';
import type { ProjectDecision } from '../shared/project-decisions';
import { decisionHash } from './decision-projection';

/** Canonical consent is evidence; a generic exception is never permission to repeat a remedy. */
export function incidentReplyProof(db: AppDb, entry: ProjectDecision, answerHash: string) {
  if (
    !entry.id.startsWith('coordinator:') ||
    entry.kind !== 'interaction' ||
    entry.interaction.kind !== 'approval'
  )
    return;
  const project = entry.origin.projectId;
  const id = entry.id.slice('coordinator:'.length);
  const saved = db.coordination.decisions.get(project, id);
  if (!saved || saved.kind !== 'approval') return;
  const choice = ['allow_once', 'deny'].find(
    (choice) =>
      decisionHash({
        kind: 'respond',
        answer: { kind: 'approval', choice },
      }) === answerHash,
  );
  if (!choice) return;
  return incidentApprovalProof(db, project, id, choice);
}

export function incidentApprovalProof(db: AppDb, project: string, id: string, choice: string) {
  const saved = db.coordination.decisions.get(project, id);
  if (!saved || saved.kind !== 'approval') return;
  if (
    saved.state === (choice === 'deny' ? 'denied' : 'answered') &&
    saved.evidence?.code === choice &&
    saved.evidence.fingerprint === saved.inputHash
  )
    return choice === 'deny' ? ('denied' as const) : ('answered' as const);
  if (!['pending', 'cancelled'].includes(saved.state)) return;
  const request = db.getSetting<{ action?: RemedyAction } | undefined>(
    `coordination.decision-action.${id}`,
    undefined,
    { strict: true },
  );
  if (
    !request?.action ||
    request.action.projectId !== project ||
    request.action.incidentId !== saved.subject.id ||
    remedyKey(request.action) !== saved.inputHash
  )
    return;
  const approval = db.getSetting<unknown>(
    `coordination.approval.${project}.${saved.inputHash}`,
    undefined,
    { strict: true },
  );
  // The old controller wrote the policy first and then the decision synchronously. With neither
  // present, its validation failed before dispatch. Partial or conflicting evidence stays unknown.
  if (approval === undefined) return 'not_dispatched' as const;
}
