import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { AppDb, incidentHash, type IncidentProtocol } from '@skaro/core';
import { ProjectCoordinators } from './project-coordinators';
import { IncidentStore } from './incident-store';
import { coordinationHash, coordinationRequest } from './project-coordinator-request';
import { incidentOperationId } from './incident-operation';

it('renews only a new controller-observed wait after a proven undispatched attempt', async () => {
  const db = AppDb.open(':memory:');
  const project = db.addProject({ name: 'Observed repository', path: process.cwd() });
  const coordinators = new ProjectCoordinators(db);
  const store = new IncidentStore(db, coordinators);
  try {
    coordinators.recover();
    const protocol: IncidentProtocol = {
      cause: 'environment',
      code: 'environment_waiting_resource',
      condition: 'environment-ready',
      phase: 'diagnosing',
      resourceVersion: incidentHash('observed'),
      attempts: 0,
      subscriptions: [],
    };
    const subscription = {
      taskId: 'observed',
      runId: 'observed-run',
      inputs: incidentHash('inputs'),
      intent: 1,
    };
    let row = await store.report(
      project.id,
      { kind: 'resource', id: 'observed-resource' },
      protocol,
      subscription,
      'admission',
      'controller',
    );
    const firstId = incidentOperationId(row);
    const operation = db.coordination.accept(
      coordinationRequest({
        id: firstId,
        projectId: project.id,
        action: 'incident.remedy',
        subject: row.subject,
        source: { kind: 'controller', id: project.id },
        scopeKey: 'observed',
        mode: 'control',
        inputHash: coordinationHash('start'),
      }),
    );
    const claim = db.coordination.claim(project.id, operation.id, {
      claimId: randomUUID(),
      expectedRevision: operation.revision,
    });
    db.coordination.finish(project.id, operation.id, {
      claimId: claim.operation.claimId!,
      expectedRevision: claim.operation.revision,
      state: 'failed',
      evidence: { code: 'environment_not_dispatched_before_admission', refs: [row.subject] },
    });
    row = store.update(row, { attempts: 1, phase: 'waiting', operationId: operation.id });
    expect(
      (
        await store.report(
          project.id,
          row.subject,
          protocol,
          subscription,
          'same intent',
          'controller',
        )
      ).protocol!.attempts,
    ).toBe(1);
    expect(
      (
        await store.report(
          project.id,
          row.subject,
          protocol,
          { ...subscription, intent: 2 },
          'worker report',
          'worker',
        )
      ).protocol!.attempts,
    ).toBe(1);
    row = await store.report(
      project.id,
      row.subject,
      protocol,
      { ...subscription, intent: 3 },
      'new exact start',
      'controller',
    );
    expect(row.protocol).toMatchObject({ attempts: 0, phase: 'diagnosing' });
    expect(row.protocol!.operationId).toBeUndefined();
    expect(incidentOperationId(row)).not.toBe(firstId);
  } finally {
    await coordinators.close();
    db.close();
  }
});
