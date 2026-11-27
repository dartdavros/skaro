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
import { commitIncidentApproval, validateIncidentAnswer } from './incident-answer-validation';
import { DecisionNotDispatched } from './decision-not-dispatched';
import { incidentRequestIdentity } from './incident-request-identity';

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
    if (policy.expiresAt <= Date.now()) return;
    const id = incidentRequestIdentity(this.ctx.deps.db, row, action, policy.revision);
    if (row.protocol!.decisionId && row.protocol!.decisionId !== id)
      await cancelIncidentApproval(this.ctx, row, row.protocol!.decisionId, 'decision_superseded');
    const pending = this.ctx.deps.db.settings.atomic(() => {
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
      if (saved.state !== 'pending') return false;
      row = this.incidents.store.update(this.incidents.store.get(row.projectId, row.id), {
        decisionId: id,
      });
      return true;
    });
    if (!pending) return;
    await showIncidentApproval(this.ctx, row, action, id);
  }
  async answer(
    projectId: string,
    decisionId: string,
    answer: InteractionAnswer,
    taskId?: string,
  ): Promise<void> {
    if (!this.ctx.deps.coordinators && (answer.kind !== 'approval' || answer.choice !== 'deny'))
      throw new DecisionNotDispatched(
        'Historical incidents cannot authorize task execution. Use the task chat.',
      );
    let prepared: Awaited<ReturnType<typeof validateIncidentAnswer>>;
    try {
      prepared = await validateIncidentAnswer(
        this.ctx,
        this.incidents,
        projectId,
        decisionId,
        answer,
        taskId,
      );
    } catch (error) {
      if (error instanceof DecisionNotDispatched && error.message === 'decision_stale') {
        const saved = this.ctx.deps.db.coordination.decisions.get(projectId, decisionId);
        if (saved?.state === 'pending') {
          const row = this.incidents.store.get(projectId, saved.subject.id);
          await cancelIncidentApproval(this.ctx, row, decisionId, 'decision_context_stale');
          this.reconcileLater(projectId, row.id);
        }
      }
      throw error;
    }
    const { row } = prepared;
    if (prepared.kind === 'question')
      return answerIncidentEscalation(this.ctx, row, decisionId, answer);
    if (answer.kind !== 'approval' || answer.choice === 'allow_session')
      throw new DecisionNotDispatched('Exact approval required');
    commitIncidentApproval(this.ctx.deps.db, this.incidents.policy, prepared, answer.choice);
    await closeIncidentApproval(this.ctx, row, decisionId, answer);
    if (answer.choice !== 'deny') this.reconcileLater(projectId, row.id);
  }
  private reconcileLater(projectId: string, id: string) {
    void this.incidents.reconcile(projectId, id).catch((error: unknown) => {
      this.ctx.deps.db.addEvent(projectId, 'incident_diagnosis_deferred', {
        incident: id,
        reason: incidentHash(String(error)),
      });
    });
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
