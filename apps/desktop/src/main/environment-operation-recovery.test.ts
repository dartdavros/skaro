import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppDb, type ResourceCost } from '@skaro/core';
import { expect, it } from 'vitest';
import { coordinationHash, coordinationRequest } from './project-coordinator-request';
import { reconcileUnstartedEnvironments } from './environment-operation-recovery';
import { environmentToolPolicy } from './coordinated-tool-policy';
import { dispatchProjectOperation } from './coordinator-delivery';
import { environmentPreflightFailed } from './environment-operation-recovery';
import type { EnvironmentRecord } from './task-environment-registry';

it('reconciles a real SQLite admission waiter without replaying effects and preserves uncertain grants', async () => {
  const db = AppDb.open(':memory:');
  try {
    const p = db.addProject({ name: 'Observed repository', path: process.cwd() });
    const cost: ResourceCost = {
      ramBytes: 1024,
      cpuMillis: 1,
      model: 0,
      environment: 1,
      build: 0,
      review: 0,
      diskBytes: {},
    };
    const operations = [];
    for (const granted of [false, true]) {
      const id = randomUUID();
      const accepted = db.coordination.accept(
        coordinationRequest({
          id,
          projectId: p.id,
          action: 'mcp.start_environment',
          source: { kind: 'controller', id: p.id },
          subject: { kind: 'task', id },
          scopeKey: `environment:${id}`,
          mode: 'control',
          inputHash: coordinationHash(id),
        }),
      );
      const claim = db.coordination.claim(p.id, id, {
        claimId: randomUUID(),
        expectedRevision: accepted.revision,
      });
      let lease = db.admission.request({
        id: randomUUID(),
        projectId: p.id,
        ownerId: `environment:${id}`,
        intentId: id,
        checkpoint: 'environment',
        cost,
        locks: [],
      });
      if (granted)
        lease = db.admission.admit(p.id, lease.id, lease.revision, {
          ...cost,
          measuredAt: Date.now(),
          maxAgeMs: 5000,
          accounts: {},
        });
      db.admission.stop(p.id, lease.id, lease.revision);
      expect(claim.acquired).toBe(true);
      operations.push(id);
    }
    db.coordination.recover(p.id);
    reconcileUnstartedEnvironments(db, p.id);
    expect(db.coordination.getOperation(p.id, operations[0]!)?.state).toBe('failed');
    expect(db.coordination.getOperation(p.id, operations[1]!)?.state).toBe('uncertain');
    const scope = { kind: 'task' as const, projectId: p.id, taskId: operations[1]! };
    const read = environmentToolPolicy(db, 'configure_environment', {}, scope)!;
    expect(read.mode).toBe('observation');
    const next = db.coordination.accept(
      coordinationRequest({
        id: randomUUID(),
        projectId: p.id,
        action: 'mcp.configure_environment',
        source: { kind: 'controller', id: p.id },
        subject: { kind: 'task', id: scope.taskId },
        ...read,
        inputHash: coordinationHash({}),
      }),
    );
    const content = await dispatchProjectOperation(db.coordination, next, () =>
      readFile(join(process.cwd(), 'package.json'), 'utf8'),
    );
    expect(content).toContain('"name"');
    expect(
      environmentToolPolicy(db, 'start_environment', {}, { ...scope, taskId: operations[0]! })!
        .scopeKey,
    ).not.toBe(environmentToolPolicy(db, 'start_environment', {}, scope)!.scopeKey);
  } finally {
    db.close();
  }
});

it('recovers a Compose preflight failure only with evidence of its exact dispatch', () => {
  let now = 1000;
  const db = AppDb.open(':memory:', () => now);
  try {
    const { id: project } = db.addProject({
      name: 'Compose preflight receipt',
      path: process.cwd(),
    });
    const request = coordinationRequest({
      id: 'remedy',
      projectId: project,
      action: 'incident.remedy',
      source: { kind: 'controller', id: 'coordinator' },
      subject: { kind: 'resource', id: 'environment' },
      scopeKey: 'remedy:environment',
      mode: 'control',
      inputHash: coordinationHash('environment'),
    });
    const accepted = db.coordination.accept(request);
    db.coordination.claim(project, accepted.id, {
      expectedRevision: accepted.revision,
      claimId: 'claim',
    });
    const cost = {
      ramBytes: 0,
      cpuMillis: 0,
      model: 0,
      environment: 0,
      build: 1,
      review: 0,
      diskBytes: {},
    };
    let lease = db.admission.request({
      id: 'build-lease',
      projectId: project,
      ownerId: accepted.id,
      intentId: accepted.id,
      checkpoint: 'build',
      cost,
      locks: [],
    });
    lease = db.admission.admit(project, lease.id, lease.revision);
    const record: EnvironmentRecord = {
      projectId: project,
      taskId: 'T-1',
      name: 'task',
      ports: {},
      created: false,
      usedAt: now,
      lastStart: {
        at: ++now,
        queuedMs: 0,
        prepareMs: 1,
        createMs: 0,
        startMs: 0,
        readyMs: 0,
        reusedData: false,
        error: 'Compose port admission failed: env_file is missing',
      },
    };
    now++;
    lease = db.admission.release(project, lease.id, lease.revision, {}, 'bounded_executor_settled');
    db.coordination.recover(project);
    const operation = db.coordination.getOperation(project, accepted.id)!;
    expect(environmentPreflightFailed(operation, record, [lease])).toBe(true);
    expect(environmentPreflightFailed(operation, record, [])).toBe(false);
    expect(
      environmentPreflightFailed(
        operation,
        {
          ...record,
          lastStart: { ...record.lastStart!, startMs: 1 },
        },
        [lease],
      ),
    ).toBe(false);
    expect(
      environmentPreflightFailed(
        operation,
        {
          ...record,
          lastStart: { ...record.lastStart!, operationId: operation.id, preflightFailed: true },
        },
        [],
      ),
    ).toBe(true);
  } finally {
    db.close();
  }
});
