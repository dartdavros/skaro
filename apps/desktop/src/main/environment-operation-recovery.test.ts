import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppDb, type ResourceCost } from '@skaro/core';
import { expect, it } from 'vitest';
import { coordinationHash, coordinationRequest } from './project-coordinator-request';
import { reconcileUnstartedEnvironments } from './environment-operation-recovery';
import { environmentToolPolicy } from './coordinated-tool-policy';
import { dispatchProjectOperation } from './coordinator-delivery';

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
