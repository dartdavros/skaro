import { randomUUID } from 'node:crypto';
import {
  incidentHash,
  incidentIdentity,
  incidentSubscribers,
  type AppDb,
  type CoordinationBlocker,
  type CoordinationBlockerInput,
  type IncidentProtocol,
  type IncidentSubscription,
  type CoordinationRef,
} from '@skaro/core';
import type { ProjectCoordinators } from './project-coordinators';

/** The AC-1 incident is the single durable record; public logs retain the diagnostic text. */
export class IncidentStore {
  readonly db: AppDb;
  private readonly coordinators: ProjectCoordinators;
  constructor(db: AppDb, coordinators: ProjectCoordinators) {
    this.db = db;
    this.coordinators = coordinators;
  }
  list(projectId: string) {
    this.coordinators.version(projectId);
    return this.db.coordination.blockers.list(projectId).filter((b) => b.protocol);
  }
  get(projectId: string, id: string): CoordinationBlocker {
    this.coordinators.version(projectId);
    const row = this.db.coordination.blockers.get(projectId, id);
    if (!row?.protocol) throw new Error('Unknown project incident');
    return row;
  }
  async report(
    projectId: string,
    subject: CoordinationRef,
    protocol: IncidentProtocol,
    subscription: IncidentSubscription,
    evidence: string,
    source: 'worker' | 'controller',
  ) {
    const fingerprint = incidentIdentity(projectId, subject.id, protocol);
    const open = this.list(projectId).find(
      (b) => b.inputHash === fingerprint && b.state === 'open',
    );
    if (open) {
      const subscriptions = incidentSubscribers(open.protocol!.subscriptions, subscription);
      const prior = open.protocol!.subscriptions.find((s) => s.taskId === subscription.taskId);
      const operation =
        open.protocol!.operationId &&
        this.db.coordination.getOperation(projectId, open.protocol!.operationId);
      const renewedWait =
        source === 'controller' &&
        protocol.code === 'environment_waiting_resource' &&
        prior &&
        prior.intent !== subscription.intent &&
        operation &&
        operation.state === 'failed' &&
        [
          'environment_not_dispatched_before_admission',
          'environment_start_failed_partial_effects_possible',
        ].includes(operation.evidence?.code ?? '');
      return this.update(open, {
        subscriptions,
        ...(renewedWait ? { phase: 'diagnosing', attempts: 0, operationId: undefined } : {}),
      });
    }
    const id = randomUUID();
    return this.coordinators.execute(
      {
        id: `incident:${id}`,
        projectId,
        action: 'incident.report',
        source: { kind: source, id: subscription.runId },
        subject,
        scopeKey: `incident:${fingerprint}`,
        mode: 'control',
        inputHash: fingerprint,
      },
      () => {
        const concurrent = this.list(projectId).find(
          (b) => b.inputHash === fingerprint && b.state === 'open',
        );
        if (concurrent)
          return this.update(concurrent, {
            subscriptions: incidentSubscribers(concurrent.protocol!.subscriptions, subscription),
          });
        const operation = this.db.coordination.getOperation(projectId, `incident:${id}`)!;
        return this.db.coordination.blockers.create({
          id,
          projectId,
          eventId: operation.eventId,
          category:
            protocol.cause === 'rate-limit'
              ? 'quota'
              : protocol.cause === 'context'
                ? 'resource'
                : protocol.cause,
          subject,
          inputHash: fingerprint,
          resolution: {
            code: protocol.condition,
            refs: [subject],
            fingerprint: incidentHash(evidence),
          },
          subscribers: [{ kind: 'task', id: subscription.taskId }],
          protocol: { ...protocol, subscriptions: [subscription] },
        });
      },
    );
  }
  update(row: CoordinationBlocker, patch: Partial<IncidentProtocol>) {
    const {
      state: _state,
      evidence: _evidence,
      revision,
      createdAt: _created,
      updatedAt: _updated,
      ...input
    } = row;
    const protocol = { ...row.protocol!, ...patch };
    const next: CoordinationBlockerInput = {
      ...input,
      protocol,
      subscribers: protocol.subscriptions.map((s) => ({ kind: 'task', id: s.taskId })),
    };
    return this.db.coordination.blockers.reviseBlocker(next, revision);
  }
  resolve(row: CoordinationBlocker, fingerprint: string) {
    return this.db.coordination.blockers.transition(row.projectId, row.id, {
      expectedRevision: row.revision,
      state: 'resolved',
      evidence: { code: 'condition_verified', refs: [row.subject], fingerprint },
    });
  }
}
