import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { AppDb } from './appdb.ts';

// SQLite authority protocol only. No Docker replies, filesystem fixtures or live closure receipts.
async function setup(externalPending = false) {
  const db = AppDb.open(':memory:'),
    project = db.addProject({ name: 'protocol', path: resolve('.') });
  const resource = db.resources.register({
    projectId: project.id,
    kind: 'cache',
    identity: { path: project.path },
    owner: { kind: 'project', id: project.id },
    purpose: 'cache',
    ownership: 'registered',
    preservation: 'reproducible',
    generation: 1,
    consumers: [],
    state: 'available',
    source: { recovery: 'skaro:owned-isolated-remote-buildkit-v3', dataVersion: 'protocol' },
  });
  const grant = (control: boolean) => {
    const cost = {
      ramBytes: 128 * 1024 ** 2,
      cpuMillis: 100,
      model: 0,
      environment: control ? 0 : 1,
      build: control ? 0 : 1,
      review: 0,
      diskBytes: {},
    };
    const request = db.admission.request({
      id: randomUUID(),
      projectId: project.id,
      ownerId: control ? 'managed-cache:reconciliation' : 'managed-cache:buildkit',
      intentId: randomUUID(),
      checkpoint: control ? 'cache-reconciliation' : 'managed-cache-buildkit',
      cost,
      locks: control ? [] : [{ resourceId: resource.id, generation: 1, mode: 'exclusive' }],
    });
    return db.admission.admit(project.id, request.id, request.revision, {
      ...cost,
      ramBytes: 1024 ** 3,
      cpuMillis: 2000,
      environment: 4,
      build: 4,
      accounts: {},
      measuredAt: Date.now(),
      maxAgeMs: 60000,
    });
  };
  const old = grant(false),
    operation = `cache.maintain:${resource.id}:1`;
  await expect(
    db.resources.cleanup.runLeased(db.resources.get(resource.id)!, operation, old, async () => {
      db.resources.cleanup.effect(resource.id, externalPending);
      const current = db.resources.get(resource.id)!;
      db.resources.update(resource.id, current.revision, { objectIds: ['a'.repeat(64)] });
      throw new Error('protocol interruption');
    }),
  ).rejects.toThrow('protocol interruption');
  const retained = db.admission.retain(project.id, old.id, old.revision),
    current = db.resources.get(resource.id)!;
  const proof = {
    controller: grant(true),
    fence: db.resources.cleanup.read(resource.id),
    consumers: current.consumers,
    retained: [retained],
    verifyClosed: async () => undefined,
  };
  return { db, current, operation, retained, proof };
}

it('reconciles a positively verified unstarted allocation without dispatch, deletion or releasing its old capacity', async () => {
  const s = await setup();
  try {
    await expect(
      s.db.resources.cleanup.runCacheReconciliation(
        s.current,
        s.operation,
        s.proof,
        async () => undefined,
      ),
    ).rejects.toThrow('snapshot changed');
    await expect(
      s.db.resources.cleanup.runUnstartedBuildkitReconciliation(
        s.current,
        s.operation,
        { ...s.proof, controller: structuredClone(s.proof.controller) },
        async () => undefined,
      ),
    ).rejects.toThrow('fresh live control lease');
    await s.db.resources.cleanup.runUnstartedBuildkitReconciliation(
      s.current,
      s.operation,
      s.proof,
      async () => {
        expect(() => s.db.resources.cleanup.effect(s.current.id, true)).toThrow('cannot dispatch');
        expect(() => s.db.resources.cleanup.effect(s.current.id)).toThrow('cannot dispatch');
        expect(() =>
          s.db.resources.update(s.current.id, s.current.revision, { objectIds: [] }),
        ).toThrow('cannot mutate resources');
        s.db.resources.cleanup.reconciled(s.current.id);
      },
    );
    expect(s.db.resources.cleanup.read(s.current.id)).toBeUndefined();
    expect(s.db.resources.get(s.current.id)).toEqual(s.current);
    expect(s.db.admission.get(s.current.projectId, s.retained.id)).toEqual(s.retained);
  } finally {
    s.db.close();
  }
});

it('refuses an ambiguous external executor even with a fresh controller and a callback', async () => {
  const s = await setup(true);
  try {
    await expect(
      s.db.resources.cleanup.runUnstartedBuildkitReconciliation(
        s.current,
        s.operation,
        s.proof,
        async () => undefined,
      ),
    ).rejects.toThrow('snapshot changed');
    expect(s.db.resources.cleanup.read(s.current.id)).toEqual(s.proof.fence);
  } finally {
    s.db.close();
  }
});
