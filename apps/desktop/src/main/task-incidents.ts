import {
  incidentHash,
  type CoordinationBlocker,
  type IncidentCause,
  type IncidentProtocol,
} from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import { IncidentStore } from './incident-store';
import { IncidentPolicy } from './incident-policy';
import { checkIncident, currentIncidentSubscriber, incidentAction } from './incident-condition';
import { IncidentDecisions } from './incident-decisions';
import { executeIncident } from './incident-execution';
import { incidentFailure } from './incident-failure';
import { cancelIncidentApproval } from './incident-feed';
import { continueResolvedIncident } from './incident-continuation';
import { requireCoordinationDispatch } from './coordination-dispatch';
import { checkoutKey } from './task-stage';
import { hasEnvironmentWait } from './incident-environment-wait';
import { escalateIncident } from './incident-escalation';
import { refreshIncidentContext } from './incident-context-refresh';
import { IncidentWork } from './incident-work';
import { canRenewIncidentApproval } from './incident-approval-renewal';
import { reportTaskIncident } from './task-incident-report';
import { retireCapacityWait } from './resource-wait-retirement';
import { bindIncidentEnvironment } from './incident-environment-verification';
import { bindIncidentSession } from './incident-session-verification';
import { retireTerminalIncident } from './incident-retirement';

export interface TaskBlockerDetails {
  cause: IncidentCause;
  code: string;
  resourceId?: string;
  condition?: IncidentProtocol['condition'];
}

export class TaskIncidents {
  private readonly running = new Map<string, Promise<void>>();
  private readonly retirements = new Map<string, Promise<void>>();
  readonly decisions: IncidentDecisions;
  readonly work: IncidentWork;
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
    this.decisions = new IncidentDecisions(ctx, this);
    this.work = new IncidentWork((projectId, id) => {
      const row = ctx.deps.db.coordination.blockers.get(projectId, id);
      for (const subscriber of row?.protocol?.subscriptions ?? []) {
        const active = ctx.active.get(`${projectId}\n${subscriber.taskId}`);
        if (active?.run.id === subscriber.runId) ctx.events.settleRuntime(active);
      }
    });
  }
  get store() {
    return new IncidentStore(this.ctx.deps.db, this.ctx.deps.coordinators!);
  }
  get policy() {
    return new IncidentPolicy(this.ctx.deps.db, this.ctx.deps.coordinators!);
  }
  escalate(row: CoordinationBlocker) {
    return escalateIncident(this.ctx, row);
  }
  bindEnvironment(row: CoordinationBlocker, id: string) {
    return bindIncidentEnvironment(this.ctx, row, id);
  }
  bindSession(row: CoordinationBlocker) {
    return bindIncidentSession(this.ctx, row);
  }
  projectChanged(projectId: string): void {
    if (this.ctx.deps.coordinators && !this.ctx.closing)
      void this.retireTerminal(projectId).catch((error: unknown) =>
        console.error('Terminal incident retirement:', error),
      );
  }
  retireTerminal(projectId: string): Promise<void> {
    const existing = this.retirements.get(projectId);
    if (existing) return existing;
    const pending = (async () => {
      for (const row of this.store.list(projectId))
        if (row.state === 'open') await retireTerminalIncident(this.ctx, row);
    })().finally(() => this.retirements.delete(projectId));
    this.retirements.set(projectId, pending);
    return pending;
  }

  report(
    active: ActiveRun,
    reason: string,
    details?: TaskBlockerDetails,
    source: 'worker' | 'controller' = 'worker',
    operationId?: string,
  ): Promise<CoordinationBlocker> {
    return reportTaskIncident(this.ctx, this, active, reason, details, source, operationId);
  }
  async failure(active: ActiveRun, error: unknown): Promise<void> {
    if (!this.ctx.deps.coordinators) return;
    const details = incidentFailure(error);
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error);
    await this.report(active, message, details, 'controller');
  }
  async afterTurn(active: ActiveRun): Promise<boolean> {
    const id = this.ctx.continuation.execution(active).read().blockedIncident;
    if (id) await this.reconcile(active.projectId, id);
    return !!id;
  }
  reconcile(projectId: string, id: string): Promise<void> {
    const key = `${projectId}:${id}`;
    const existing = this.running.get(key);
    if (existing) return existing;
    const pending = this.advance(projectId, id).finally(() => this.running.delete(key));
    this.running.set(key, pending);
    return pending;
  }
  async idle(): Promise<void> {
    await Promise.allSettled([...this.running.values(), ...this.retirements.values()]);
  }
  private async advance(projectId: string, id: string): Promise<void> {
    let row = this.store.get(projectId, id);
    if (row.state !== 'open' || this.ctx.closing) return;
    if (await retireTerminalIncident(this.ctx, row)) return;
    if (await retireCapacityWait(this.ctx, row)) return;
    const subscribers = [];
    for (const s of row.protocol!.subscriptions)
      if (await currentIncidentSubscriber(this.ctx, projectId, s)) subscribers.push(s);
    if (
      !subscribers.length ||
      subscribers.some(
        (s) =>
          this.ctx.active.get(`${projectId}\n${s.taskId}`)?.timeline.state.status === 'working',
      )
    )
      return;
    // Old workers reported an environment against their run when resource_id was unknown.
    // Preserve that incident as history and bind a new exact condition before any repair.
    if (row.subject.kind === 'run' && row.protocol!.cause === 'environment') {
      const subscription = subscribers[0]!;
      const active = await this.ctx.history.restore(projectId, subscription.taskId);
      if (
        active &&
        subscribers.every((s) => s.runId === row.subject.id && s.taskId === subscription.taskId)
      ) {
        const resource = await this.ctx.environments.incidentResource(checkoutKey(active));
        if (resource) {
          const next = await this.report(
            active,
            this.ctx.continuation.execution(active).read().blocked ?? row.protocol!.code,
            {
              cause: 'environment',
              code: row.protocol!.code,
              resourceId: resource.id,
              condition: 'environment-ready',
            },
            'controller',
          );
          const current = this.store.get(projectId, row.id);
          this.ctx.deps.db.coordination.blockers.transition(projectId, row.id, {
            expectedRevision: current.revision,
            state: 'cancelled',
            evidence: {
              code: 'incident_resource_identified',
              refs: [next.subject, { kind: 'blocker', id: next.id }],
            },
          });
          if (current.protocol!.decisionId)
            await cancelIncidentApproval(
              this.ctx,
              current,
              current.protocol!.decisionId,
              'incident_resource_identified',
            );
          return this.reconcile(projectId, next.id);
        }
      }
    }
    try {
      if (await refreshIncidentContext(this.ctx, this, row, subscribers)) return;
      if (await checkIncident(this.ctx, row)) return this.resolved(row);
    } catch {
      await escalateIncident(this.ctx, row);
      return;
    }
    requireCoordinationDispatch(this.ctx.deps.db, projectId);
    // An interrupted dispatch is not permission to repeat an unknown external effect.
    if (row.protocol!.phase === 'executing' || row.protocol!.phase === 'verifying') {
      await escalateIncident(this.ctx, row);
      return;
    }
    if (row.protocol!.attempts >= 2) {
      this.store.update(row, { phase: 'exhausted' });
      await escalateIncident(this.ctx, row);
      return;
    }
    const action = await incidentAction(this.ctx, row).catch((error: unknown) => {
      this.ctx.deps.db.addEvent(projectId, 'incident_diagnosis_deferred', {
        incident: row.id,
        reason: incidentHash(String(error)),
      });
      return undefined;
    });
    if (!action) {
      this.store.update(row, { phase: 'waiting' });
      await escalateIncident(this.ctx, row);
      return;
    }
    let authority = this.policy.authority(action);
    const transferred = hasEnvironmentWait(this.ctx, row, action);
    if (authority === 'delegation') {
      // Deterministic coordinator decision for the two bounded, mechanically verifiable remedies.
      // No model call, credential change or additional spend is authorized by delegation.
      this.policy.decide(
        action,
        true,
        'coordinator',
        'Registered remedy with current subscriber evidence',
        Math.min(Date.now() + 15 * 60_000, this.policy.read(projectId).expiresAt),
      );
      authority = this.policy.authority(action);
    }
    if (authority !== 'allowed' && !transferred) {
      row = this.store.update(row, { phase: 'waiting' });
      if (
        authority === 'confirmation' ||
        canRenewIncidentApproval(
          this.ctx.deps.db,
          action,
          this.policy.read(projectId),
          this.policy.approval(action),
        )
      )
        await this.decisions.request(row, action);
      return;
    }
    await executeIncident(this.ctx, this, row, action);
  }
  async resolved(row: CoordinationBlocker): Promise<void> {
    if (row.protocol!.operationId) {
      const op = this.ctx.deps.db.coordination.getOperation(
        row.projectId,
        row.protocol!.operationId,
      );
      if (op?.state === 'uncertain')
        this.ctx.deps.coordinators!.reconcile(
          row.projectId,
          op.id,
          {
            code: 'condition_verified_after_restart',
            refs: [row.subject],
            fingerprint: row.protocol!.resourceVersion,
          },
          'succeeded',
        );
    }
    const resolved = this.store.resolve(
      row,
      incidentHash([row.protocol!.resourceVersion, Date.now()]),
    );
    if (row.protocol!.decisionId)
      await cancelIncidentApproval(this.ctx, row, row.protocol!.decisionId, 'condition_verified');
    this.ctx.deps.db.addEvent(row.projectId, 'incident_resolved', {
      incident: row.id,
      resource: row.subject.id,
    });
    await continueResolvedIncident(this.ctx, resolved);
  }
}
