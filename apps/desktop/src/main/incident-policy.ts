import {
  incidentHash,
  parseRemedyPolicy,
  remedyAuthority,
  remedyKey,
  type AppDb,
  type RemedyAction,
  type RemedyPolicy,
  type RemedyApproval,
} from '@skaro/core';
import type { ProjectCoordinators } from './project-coordinators';
import { canRenewIncidentApproval } from './incident-approval-renewal';

/** Only owner IPC writes policies; delegated model decisions never edit the envelope. */
export class IncidentPolicy {
  private readonly db: AppDb;
  private readonly coordinators: ProjectCoordinators;
  constructor(db: AppDb, coordinators: ProjectCoordinators) {
    this.db = db;
    this.coordinators = coordinators;
  }
  read(projectId: string): RemedyPolicy {
    this.coordinators.version(projectId);
    return this.db.getSetting(`coordination.policy.${projectId}`, {
      revision: 0,
      mode: 'confirm',
      expiresAt: Number.MAX_SAFE_INTEGER,
      rules: [],
      denied: [],
    });
  }
  save(projectId: string, input: unknown, expected: number) {
    const old = this.read(projectId);
    if (old.revision !== expected) throw new Error('Coordinator policy changed');
    const policy = parseRemedyPolicy(input, expected + 1);
    this.db.setSetting(`coordination.policy.${projectId}`, policy);
    this.db.addEvent(projectId, 'coordinator_policy_changed', { revision: policy.revision });
    return policy;
  }
  approval(action: RemedyAction): RemedyApproval | undefined {
    this.read(action.projectId);
    return this.db.getSetting<RemedyApproval | undefined>(
      `coordination.approval.${action.projectId}.${remedyKey(action)}`,
      undefined,
    );
  }
  authority(action: RemedyAction) {
    return remedyAuthority(action, this.read(action.projectId), this.approval(action), Date.now());
  }
  decide(
    action: RemedyAction,
    allow: boolean,
    author: 'owner' | 'coordinator',
    reason: string,
    expiresAt: number,
    decisionId?: string,
  ) {
    const policy = this.read(action.projectId);
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= Date.now() ||
      expiresAt > policy.expiresAt ||
      !reason.trim()
    )
      throw new Error('Decision requires current expiry and reason');
    const approval: RemedyApproval = {
      action: remedyKey(action),
      policyRevision: policy.revision,
      expiresAt,
      author,
      decision: allow ? 'allow' : 'deny',
    };
    if (
      author === 'coordinator' &&
      (policy.mode !== 'delegated' ||
        remedyAuthority(action, policy, { ...approval, decision: 'allow' }, Date.now()) !==
          'allowed')
    )
      throw new Error('Delegated decision exceeds owner policy');
    const previous = this.approval(action);
    const decision = decisionId && this.db.coordination.decisions.get(action.projectId, decisionId);
    const incident = this.db.coordination.blockers.get(action.projectId, action.incidentId);
    const renewed =
      author === 'owner' &&
      decision &&
      decision.state === 'pending' &&
      decision.kind === 'approval' &&
      decision.subject.kind === 'blocker' &&
      decision.inputHash === remedyKey(action) &&
      decision.subject.id === action.incidentId &&
      incident?.protocol?.decisionId === decisionId &&
      canRenewIncidentApproval(this.db, action, policy, previous);
    if (previous?.decision === 'deny' || previous?.revoked || (previous?.consumed && !renewed))
      throw new Error('Denied or revoked action requires a new owner policy and request');
    this.db.setSetting(`coordination.approval.${action.projectId}.${remedyKey(action)}`, approval);
    this.db.addEvent(action.projectId, 'coordinator_decision', {
      action: remedyKey(action),
      author,
      allow,
      policy: policy.revision,
      reason: incidentHash(reason),
    });
    return approval;
  }
  consume(action: RemedyAction) {
    const previous = this.approval(action);
    if (previous?.author === 'owner')
      this.db.setSetting(`coordination.approval.${action.projectId}.${remedyKey(action)}`, {
        ...previous,
        consumed: true,
      });
  }
  revoke(action: RemedyAction) {
    const previous = this.approval(action);
    const policy = this.read(action.projectId);
    this.db.setSetting(`coordination.approval.${action.projectId}.${remedyKey(action)}`, {
      action: remedyKey(action),
      policyRevision: policy.revision,
      expiresAt: policy.expiresAt,
      author: 'owner',
      decision: 'deny',
      ...previous,
      revoked: true,
    });
    this.db.addEvent(action.projectId, 'coordinator_decision_revoked', {
      action: remedyKey(action),
    });
  }
}
