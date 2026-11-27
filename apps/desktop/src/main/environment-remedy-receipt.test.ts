import { expect, it } from 'vitest';
import { AppDb, incidentHash } from '@skaro/core';
import { IncidentStore } from './incident-store';
import { ProjectCoordinators } from './project-coordinators';
import { coordinationRequest } from './project-coordinator-request';
import { dispatchProjectOperation } from './coordinator-delivery';
import { reconcileUnstartedEnvironments } from './environment-operation-recovery';
import { environmentFailureHandoff } from './environment-incident-handoff';

it('releases a failed legacy environment dispatch after a later Compose check overwrote its timing', async () => {
  let now = 1000;
  const db = AppDb.open(':memory:', () => now);
  const coordinator = new ProjectCoordinators(db);
  try {
    const { id: projectId } = db.addProject({
      name: 'Legacy dispatch metadata',
      path: process.cwd(),
    });
    const resource = db.resources.register({
      projectId,
      kind: 'environment',
      identity: { composeProject: 'task-environment' },
      owner: { kind: 'task', id: 'T-1' },
      purpose: 'task',
      ownership: 'registered',
      preservation: 'disposable',
      generation: 1,
      consumers: [],
      state: 'available',
    });
    const subject = { kind: 'resource' as const, id: resource.id, version: resource.generation };
    const store = new IncidentStore(db, coordinator);
    const row = await store.report(
      projectId,
      subject,
      {
        cause: 'environment',
        code: 'environment_start_failed',
        condition: 'environment-ready',
        phase: 'diagnosing',
        attempts: 0,
        subscriptions: [],
        resourceVersion: incidentHash(resource.id),
      },
      { taskId: 'T-1', runId: 'run', inputs: incidentHash('inputs'), intent: 1 },
      'Compose admission failed',
      'controller',
    );
    const operation = db.coordination.accept(
      coordinationRequest({
        id: 'remedy',
        projectId,
        subject,
        action: 'incident.remedy',
        mode: 'control',
        scopeKey: `remedy:${resource.id}`,
        source: { kind: 'controller', id: 'project-coordinator' },
        inputHash: incidentHash('bounded environment attempt'),
      }),
    );
    store.update(row, { attempts: 1, phase: 'verifying', operationId: operation.id });
    const hash = incidentHash('Error: Compose port admission failed');
    await expect(
      dispatchProjectOperation(db.coordination, operation, () => {
        now++;
        let lease = db.admission.request({
          id: 'build-lease',
          projectId,
          ownerId: operation.id,
          intentId: operation.id,
          checkpoint: 'build',
          cost: {
            ramBytes: 0,
            cpuMillis: 0,
            model: 0,
            environment: 0,
            build: 1,
            review: 0,
            diskBytes: {},
          },
          locks: [],
        });
        lease = db.admission.admit(projectId, lease.id, lease.revision);
        now++;
        db.admission.release(projectId, lease.id, lease.revision, {}, 'bounded_executor_settled');
        throw new Error('Compose port admission failed');
      }),
    ).rejects.toThrow('Compose port admission failed');
    now++;
    db.addEvent(projectId, 'incident_remedy_failed', { incident: 'another-incident', error: hash });
    db.setSetting('environments', [
      {
        projectId,
        taskId: 'T-1',
        name: 'task-environment',
        created: false,
        ports: {},
        usedAt: now,
        lastStart: { at: ++now, error: 'Later check' },
      },
    ]);

    reconcileUnstartedEnvironments(db, projectId);
    expect(db.coordination.getOperation(projectId, operation.id)?.state).toBe('uncertain');
    expect(environmentFailureHandoff(db, store.get(projectId, row.id))).toBeUndefined();
    db.addEvent(projectId, 'incident_remedy_failed', { incident: row.id, error: hash });
    reconcileUnstartedEnvironments(db, projectId);
    expect(db.coordination.getOperation(projectId, operation.id)).toMatchObject({
      state: 'failed',
      evidence: { code: 'environment_start_failed_partial_effects_possible', fingerprint: hash },
    });
    expect(store.get(projectId, row.id).state).toBe('open');
    expect(environmentFailureHandoff(db, store.get(projectId, row.id))).toEqual({
      operationId: operation.id,
    });
    const [record] = db.getSetting<{ lastStart: { at: number; error: string } }[]>(
      'environments',
      [],
    );
    db.setSetting('environments', [
      {
        ...record,
        lastStart: {
          ...record!.lastStart,
          operationId: operation.id,
          error: 'TLS handshake timeout',
        },
      },
    ]);
    expect(environmentFailureHandoff(db, store.get(projectId, row.id))).toEqual({
      operationId: operation.id,
      error: 'TLS handshake timeout',
    });
  } finally {
    await coordinator.close();
    db.close();
  }
});
