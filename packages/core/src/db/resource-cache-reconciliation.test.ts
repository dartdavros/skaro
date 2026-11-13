import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { AppDb } from './appdb.ts';
import type { ResourceBudget } from '../resources/admission-model.ts';

/** In-memory ledger contracts only. No filesystem projects, executors or live recovery receipts are manufactured. */
async function ledger() {
  const db = AppDb.open(':memory:');
  const project = db.addProject({ name: 'Skaro metadata', path: resolve('.') });
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
  });
  const budget: ResourceBudget = {
    ramBytes: 1024 ** 3,
    cpuMillis: 1000,
    model: null,
    environment: null,
    build: null,
    review: null,
    diskBytes: {},
    accounts: {},
    measuredAt: Date.now(),
    maxAgeMs: 60_000,
  };
  function grant(control: boolean) {
    const queued = db.admission.request({
      id: randomUUID(),
      projectId: project.id,
      ownerId: control ? 'managed-cache:reconciliation' : 'managed-cache:dependencies',
      intentId: randomUUID(),
      checkpoint: control ? 'cache-reconciliation' : 'managed-cache-dependencies',
      locks: control ? [] : [{ resourceId: resource.id, generation: 1, mode: 'exclusive' }],
      cost: {
        ramBytes: 128 * 1024 ** 2,
        cpuMillis: 100,
        model: 0,
        environment: 0,
        build: 0,
        review: 0,
        diskBytes: {},
      },
    });
    return db.admission.admit(project.id, queued.id, queued.revision, budget);
  }
  const old = grant(false);
  await expect(
    db.resources.cleanup.runLeased(
      db.resources.get(resource.id)!,
      'metadata-effect',
      old,
      async () => {
        db.resources.cleanup.effect(resource.id, true);
        throw new Error('Metadata-only interrupted effect barrier');
      },
    ),
  ).rejects.toThrow('interrupted effect');
  const retained = db.admission.retain(project.id, old.id, old.revision);
  const current = db.resources.get(resource.id)!;
  const proof = {
    controller: grant(true),
    fence: db.resources.cleanup.read(resource.id),
    consumers: current.consumers,
    retained: [retained],
    async verifyClosed() {
      // This metadata test dispatched no executor; it claims no physical cleanup or live acceptance.
      expect(db.admission.get(project.id, retained.id)?.state).toBe('retained');
    },
  };
  return { db, resource: current, retained, proof, grant };
}

it('requires fresh opaque control authority and positive host verification without changing ordinary claim rules', async () => {
  const { db, resource, retained, proof } = await ledger();
  try {
    await expect(
      db.resources.cleanup.runLeased(resource, 'metadata-effect', retained, async () => undefined),
    ).rejects.toThrow('current exact exclusive lease');
    await expect(
      db.resources.cleanup.runCacheReconciliation(
        resource,
        'metadata-effect',
        { ...proof, controller: structuredClone(proof.controller) },
        async () => undefined,
      ),
    ).rejects.toThrow('fresh live control lease');
    await expect(
      db.resources.cleanup.runCacheReconciliation(
        resource,
        'metadata-effect',
        {
          ...proof,
          async verifyClosed() {
            throw new Error('Domain executor receipt absent');
          },
        },
        async () => undefined,
      ),
    ).rejects.toThrow('receipt absent');
    expect(db.resources.cleanup.read(resource.id)).toEqual(proof.fence);
    expect(db.admission.get(resource.projectId, retained.id)).toEqual(retained);
  } finally {
    db.close();
  }
});

it('locally reconciles only the captured cache generation and leaves old capacity held until explicit settlement', async () => {
  const { db, resource, retained, proof } = await ledger();
  try {
    await db.resources.cleanup.runCacheReconciliation(
      resource,
      'metadata-effect',
      proof,
      async () => {
        expect(() => db.resources.cleanup.effect(resource.id, true)).toThrow(
          'cannot dispatch an external executor',
        );
        db.resources.cleanup.effect(resource.id);
        const current = db.resources.get(resource.id)!;
        db.resources.update(current.id, current.revision, { state: 'released', consumers: [] });
      },
    );
    expect(db.resources.cleanup.read(resource.id)).toBeUndefined();
    expect(db.admission.get(resource.projectId, retained.id)).toEqual(retained);
    db.admission.release(
      resource.projectId,
      retained.id,
      retained.revision,
      { [resource.id]: 1 },
      'Metadata-only reconciliation complete',
    );
    expect(db.admission.get(resource.projectId, retained.id)?.state).toBe('released');
  } finally {
    db.close();
  }
});

it('rejects stale fence/consumer snapshots and stops effects after its fresh controller is retained', async () => {
  const { db, resource, proof } = await ledger();
  try {
    await expect(
      db.resources.cleanup.runCacheReconciliation(
        resource,
        'metadata-effect',
        { ...proof, fence: undefined },
        async () => undefined,
      ),
    ).rejects.toThrow('snapshot changed');
    await expect(
      db.resources.cleanup.runCacheReconciliation(
        resource,
        'metadata-effect',
        { ...proof, consumers: [] },
        async () => undefined,
      ),
    ).rejects.toThrow('snapshot changed');
    await expect(
      db.resources.cleanup.runCacheReconciliation(resource, 'metadata-effect', proof, async () => {
        db.admission.retain(resource.projectId, proof.controller.id, proof.controller.revision);
        db.resources.cleanup.effect(resource.id);
      }),
    ).rejects.toThrow('fresh live control lease');
    expect(db.resources.cleanup.read(resource.id)).toMatchObject({
      state: 'retry',
      externalPending: false,
    });
    expect(db.resources.get(resource.id)?.state).toBe('available');
  } finally {
    db.close();
  }
});

it('can finish a physically-verified released-generation barrier after metadata settlement was interrupted', async () => {
  const { db, resource, retained, proof } = await ledger();
  try {
    await expect(
      db.resources.cleanup.runCacheReconciliation(resource, 'metadata-effect', proof, async () => {
        db.resources.cleanup.effect(resource.id);
        const current = db.resources.get(resource.id)!;
        db.resources.update(current.id, current.revision, { state: 'released', consumers: [] });
        throw new Error('Metadata settlement interrupted after release');
      }),
    ).rejects.toThrow('settlement interrupted');
    const released = db.resources.get(resource.id)!;
    const fence = db.resources.cleanup.read(resource.id);
    expect(fence).toMatchObject({ state: 'retry', externalPending: false });
    await db.resources.cleanup.runCacheReconciliation(
      released,
      'metadata-effect',
      { ...proof, fence, consumers: [] },
      async () => undefined,
    );
    expect(db.resources.cleanup.read(resource.id)).toBeUndefined();
    expect(db.admission.get(resource.projectId, retained.id)).toEqual(retained);
  } finally {
    db.close();
  }
});

it('retains the barrier if the controller is revoked after release but before successful finalization', async () => {
  const { db, resource, proof } = await ledger();
  try {
    await expect(
      db.resources.cleanup.runCacheReconciliation(resource, 'metadata-effect', proof, async () => {
        db.resources.cleanup.effect(resource.id);
        const current = db.resources.get(resource.id)!;
        db.resources.update(current.id, current.revision, { state: 'released', consumers: [] });
        const released = db.resources.get(resource.id)!;
        expect(() =>
          db.resources.update(released.id, released.revision, {
            generation: 2,
            state: 'available',
          }),
        ).toThrow('cannot renew or reclassify');
        db.admission.retain(resource.projectId, proof.controller.id, proof.controller.revision);
      }),
    ).rejects.toThrow('fresh live control lease');
    expect(db.resources.cleanup.read(resource.id)).toMatchObject({
      state: 'retry',
      externalPending: false,
    });
  } finally {
    db.close();
  }
});
it('does not switch captured authority when a host callback replaces mutable proof inputs', async () => {
  const { db, resource, proof, grant } = await ledger();
  try {
    const original = proof.controller,
      replacement = grant(true);
    const mutable = {
      ...proof,
      async verifyClosed() {
        db.admission.retain(resource.projectId, original.id, original.revision);
        mutable.controller = replacement;
      },
    };
    await expect(
      db.resources.cleanup.runCacheReconciliation(
        resource,
        'metadata-effect',
        mutable,
        async () => undefined,
      ),
    ).rejects.toThrow('fresh live control lease');
    expect(db.resources.cleanup.read(resource.id)).toEqual(proof.fence);
  } finally {
    db.close();
  }
});
