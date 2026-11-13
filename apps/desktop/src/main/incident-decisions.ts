import { incidentHash, remedyKey, type CoordinationBlocker, type RemedyAction } from '@skaro/core';
import type { InteractionAnswer } from '@skaro/timeline';
import type { TaskRunEngine } from './task-run-engine';
import type { TaskIncidents } from './task-incidents';
import { incidentAction } from './incident-condition';
import { requireCoordinationDispatch } from './coordination-dispatch';
import {
  showIncidentApproval,
  closeIncidentApproval,
  cancelIncidentApproval,
} from './incident-feed';
import { answerIncidentEscalation } from './incident-escalation';

/** Exact, expiring owner decisions; the action policy remains independent of worker access. */
export class IncidentDecisions {
  private readonly ctx: TaskRunEngine;
  private readonly incidents: TaskIncidents;
  constructor(ctx: TaskRunEngine, incidents: TaskIncidents) {
    this.ctx = ctx;
    this.incidents = incidents;
  }
  async request(row: CoordinationBlocker, action: RemedyAction) {
    const policy = this.incidents.policy.read(row.projectId);
    const id = incidentHash([row.id, remedyKey(action), policy.revision]);
    if (row.protocol!.decisionId && row.protocol!.decisionId !== id)
      await cancelIncidentApproval(this.ctx, row, row.protocol!.decisionId, 'decision_superseded');
    if (!this.ctx.deps.db.coordination.decisions.get(row.projectId, id)) {
      this.ctx.deps.db.coordination.decisions.create({
        id,
        projectId: row.projectId,
        eventId: row.eventId,
        kind: 'approval',
        subject: { kind: 'blocker', id: row.id },
        inputHash: remedyKey(action),
      });
      this.ctx.deps.db.setSetting(`coordination.decision-action.${id}`, {
        action,
        policyRevision: policy.revision,
        expiresAt: Math.min(Date.now() + 15 * 60_000, policy.expiresAt),
      });
    }
    const saved = this.ctx.deps.db.coordination.decisions.get(row.projectId, id)!;
    if (saved.state !== 'pending') return;
    row = this.incidents.store.update(this.incidents.store.get(row.projectId, row.id), {
      decisionId: id,
    });
    await showIncidentApproval(this.ctx, row, action, id);
  }
  async answer(
    projectId: string,
    decisionId: string,
    answer: InteractionAnswer,
    taskId?: string,
  ): Promise<void> {
    if (answer.kind === 'approval' && answer.choice !== 'deny')
      requireCoordinationDispatch(this.ctx.deps.db, projectId);
    const decision = this.ctx.deps.db.coordination.decisions.get(projectId, decisionId);
    if (!decision || decision.state !== 'pending')
      throw new Error('Incident decision is not pending');
    const row = this.incidents.store.get(projectId, decision.subject.id);
    if (
      row.state !== 'open' ||
      (taskId && !row.protocol!.subscriptions.some((s) => s.taskId === taskId))
    )
      throw new Error('Decision is not owned by this active incident/task');
    if (decision.kind === 'question')
      return answerIncidentEscalation(this.ctx, row, decisionId, answer);
    if (answer.kind !== 'approval' || answer.choice === 'allow_session')
      throw new Error('Incident requires an exact one-time decision');
    const request = this.ctx.deps.db.getSetting<
      { policyRevision: number; expiresAt: number } | undefined
    >(`coordination.decision-action.${decisionId}`, undefined);
    if (
      !request ||
      request.policyRevision !== this.incidents.policy.read(projectId).revision ||
      Date.now() >= request.expiresAt
    )
      throw new Error('Incident decision expired or policy changed');
    const action = await incidentAction(this.ctx, row);
    if (!action || remedyKey(action) !== decision.inputHash)
      throw new Error('Incident action changed');
    this.incidents.policy.decide(
      action,
      answer.choice === 'allow_once',
      'owner',
      'owner approval',
      request.expiresAt,
    );
    this.ctx.deps.db.coordination.decisions.transition(projectId, decisionId, {
      expectedRevision: decision.revision,
      state: answer.choice === 'deny' ? 'denied' : 'answered',
      evidence: { code: answer.choice, refs: [row.subject], fingerprint: remedyKey(action) },
    });
    await closeIncidentApproval(this.ctx, row, decisionId, answer);
    if (answer.choice !== 'deny') await this.incidents.reconcile(projectId, row.id);
  }
  async delegate(projectId: string, id: string, allow: boolean, reason: string, expiresAt: number) {
    if (allow) requireCoordinationDispatch(this.ctx.deps.db, projectId);
    const row = this.incidents.store.get(projectId, id),
      action = await incidentAction(this.ctx, row);
    if (!action) throw new Error('Incident has no mechanically executable action');
    this.incidents.policy.decide(action, allow, 'coordinator', reason, expiresAt);
    if (allow) await this.incidents.reconcile(projectId, id);
  }
  async revoke(projectId: string, id: string) {
    const action = await incidentAction(this.ctx, this.incidents.store.get(projectId, id));
    if (action) this.incidents.policy.revoke(action);
  }
  async cancel(projectId: string, id: string) {
    const row = this.incidents.store.get(projectId, id);
    if (row.state !== 'open') return;
    this.ctx.deps.db.coordination.blockers.transition(projectId, id, {
      expectedRevision: row.revision,
      state: 'cancelled',
      evidence: { code: 'owner_cancelled', refs: [row.subject] },
    });
    if (row.protocol!.decisionId)
      await cancelIncidentApproval(this.ctx, row, row.protocol!.decisionId, 'owner_cancelled');
    // Cancellation never enables task intent; an explicit new task instruction is required.
  }
}
