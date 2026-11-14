import {
  remedyKey,
  type RemedyAction,
  type AppDb,
  type CoordinationBlocker,
  type CoordinationDecision,
} from '@skaro/core';
import type { InteractionAnswer } from '@skaro/timeline';
import type { TaskRunEngine } from './task-run-engine';
import type { TaskIncidents } from './task-incidents';
import { incidentAction } from './incident-condition';
import { requireCoordinationDispatch } from './coordination-dispatch';
import { DecisionNotDispatched } from './decision-not-dispatched';
import type { IncidentPolicy } from './incident-policy';

export interface IncidentActionRequest {
  action: RemedyAction;
  policyRevision: number;
  expiresAt: number;
}
export interface PreparedIncidentApproval {
  kind: 'approval';
  decision: CoordinationDecision;
  row: CoordinationBlocker;
  request: IncidentActionRequest;
  action: RemedyAction;
}

/** No consent or external operation is recorded during this asynchronous validation. */
export async function validateIncidentAnswer(
  ctx: TaskRunEngine,
  incidents: TaskIncidents,
  projectId: string,
  id: string,
  answer: InteractionAnswer,
  taskId?: string,
): Promise<
  | PreparedIncidentApproval
  | { kind: 'question'; decision: CoordinationDecision; row: CoordinationBlocker }
> {
  try {
    if (answer.kind === 'approval' && answer.choice !== 'deny')
      requireCoordinationDispatch(ctx.deps.db, projectId);
    const decision = ctx.deps.db.coordination.decisions.get(projectId, id);
    if (!decision || decision.state !== 'pending') throw new Error('decision_stale');
    const row = incidents.store.get(projectId, decision.subject.id);
    if (
      row.state !== 'open' ||
      row.protocol!.decisionId !== id ||
      (taskId && !row.protocol!.subscriptions.some((s) => s.taskId === taskId))
    )
      throw new Error('decision_stale');
    if (decision.kind === 'question') return { kind: 'question' as const, decision, row };
    if (answer.kind !== 'approval' || answer.choice === 'allow_session')
      throw new Error('Incident requires an exact one-time decision');
    const request = ctx.deps.db.getSetting<IncidentActionRequest | undefined>(
      `coordination.decision-action.${id}`,
      undefined,
      { strict: true },
    );
    if (
      !request ||
      request.policyRevision !== incidents.policy.read(projectId).revision ||
      Date.now() >= request.expiresAt
    )
      throw new Error('decision_stale');
    const action = await incidentAction(ctx, row);
    if (!action || remedyKey(action) !== decision.inputHash) throw new Error('decision_stale');
    const current = incidents.store.get(projectId, row.id);
    const latest = ctx.deps.db.coordination.decisions.get(projectId, id);
    if (
      current.revision !== row.revision ||
      latest?.revision !== decision.revision ||
      latest.state !== 'pending' ||
      Date.now() >= request.expiresAt ||
      incidents.policy.read(projectId).revision !== request.policyRevision
    )
      throw new Error('decision_stale');
    return { kind: 'approval' as const, decision, row, request, action };
  } catch (error) {
    throw new DecisionNotDispatched(
      error instanceof Error && error.message === 'Incident resource version changed'
        ? new Error('decision_stale', { cause: error })
        : error,
    );
  }
}

/** One synchronous transaction records exact owner consent and the canonical decision together. */
export function commitIncidentApproval(
  db: AppDb,
  policy: IncidentPolicy,
  prepared: PreparedIncidentApproval,
  choice: 'allow_once' | 'deny',
) {
  const { action, request, decision, row } = prepared;
  try {
    db.settings.atomic(() => {
      if (policy.read(row.projectId).revision !== request.policyRevision)
        throw new Error('decision_stale');
      policy.decide(action, choice === 'allow_once', 'owner', 'owner approval', request.expiresAt);
      db.coordination.decisions.transition(row.projectId, decision.id, {
        expectedRevision: decision.revision,
        state: choice === 'deny' ? 'denied' : 'answered',
        evidence: { code: choice, refs: [row.subject], fingerprint: remedyKey(action) },
      });
    });
  } catch (error) {
    throw new DecisionNotDispatched(error);
  }
}
