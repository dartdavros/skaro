import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { ApplicationResources } from './application-resources';
import { resourceHolding } from './resource-holding';

it('preserves only the original live bound review grant through the actual stopOwner teardown path', async () => {
  const path = await realpath(process.cwd());
  const db = AppDb.open(':memory:');
  const projectId = db.addProject({ name: basename(path), path }).id;
  const resources = new ApplicationResources(db, path);
  try {
    const resource = db.resources.register({
      projectId,
      kind: 'environment',
      identity: { composeProject: basename(path).toLowerCase() },
      owner: { kind: 'task', id: path },
      purpose: 'task',
      ownership: 'registered',
      preservation: 'disposable',
      generation: 1,
      state: 'available',
      consumers: [],
    });
    const ownerId = `review:${resource.owner.id}`;
    const waiting = db.admission.request({
      id: randomUUID(),
      projectId,
      ownerId,
      intentId: randomUUID(),
      checkpoint: 'metadata-review-stop',
      cost: {
        ramBytes: 0,
        cpuMillis: 0,
        model: 0,
        environment: 0,
        build: 0,
        review: 1,
        diskBytes: {},
      },
      locks: [],
    });
    const grant = db.admission.admit(projectId, waiting.id, waiting.revision, {
      ramBytes: null,
      cpuMillis: null,
      model: null,
      environment: null,
      build: null,
      review: 1,
      diskBytes: {},
      accounts: {},
      measuredAt: Date.now(),
      maxAgeMs: 60_000,
    });
    const holding = resourceHolding(db, resources.manager, grant);
    holding.bind([{ resourceId: resource.id, generation: 1, mode: 'shared' }]);
    const original = holding.lease;
    resources.stopOwner(projectId, ownerId);
    expect(holding.lease).toBe(original);
    expect(db.admission.get(projectId, original.id)?.state).toBe('retained');
    const current = db.resources.get(resource.id)!;
    const copied = structuredClone(original);
    const parsed = db.admission.get(projectId, original.id)!;
    const reconstructedHolding = resources.holdings(projectId, ownerId)[0]!.lease;
    for (const unproven of [copied, parsed, reconstructedHolding])
      await expect(
        db.resources.cleanup.runStop(current, 'review-stop', async () => undefined, unproven),
      ).rejects.toThrow('owned review stop authority');
    const checkpoint = original.checkpoint;
    original.checkpoint += ':modified';
    await expect(
      db.resources.cleanup.runStop(current, 'review-stop', async () => undefined, original),
    ).rejects.toThrow('owned review stop authority');
    original.checkpoint = checkpoint;
    await db.resources.cleanup.runStop(
      current,
      'review-stop',
      async () => {
        db.resources.cleanup.effect(resource.id, true, 'stop');
        db.resources.cleanup.externalSettled(resource.id);
        db.resources.cleanup.reconciled(resource.id);
        expect(db.admission.get(projectId, original.id)?.state).toBe('retained');
      },
      holding.lease,
    );
    expect(db.resources.cleanup.read(resource.id)).toBeUndefined();
    resources.releaseOwner(projectId, ownerId, 'metadata review stop verification complete');
    expect(db.admission.get(projectId, original.id)?.state).toBe('stopped_by_owner');
    expect(db.resources.get(resource.id)?.consumers).toEqual([]);
    expect(db.listProjects().map((project) => project.id)).toEqual([projectId]);
  } finally {
    await resources.close();
    db.close();
  }
});
