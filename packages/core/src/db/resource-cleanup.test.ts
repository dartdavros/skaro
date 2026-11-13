import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, it } from 'vitest';
import { AppDb } from './appdb.ts';
import type { ResourceBudget, ResourceLeaseRequest } from '../resources/admission-model.ts';

async function currentRepositoryLedger() {
  const db = AppDb.open(':memory:');
  const path = await realpath(process.cwd());
  const project = db.addProject({ name: 'Skaro', path });
  const resource = db.resources.register({
    projectId: project.id,
    kind: 'cache',
    identity: { path },
    owner: { kind: 'project', id: project.id },
    purpose: 'cache',
    ownership: 'registered',
    preservation: 'reproducible',
    generation: 1,
    consumers: [],
    state: 'available',
  });
  const request = (locks: ResourceLeaseRequest['locks'] = []) =>
    db.admission.request({
      id: randomUUID(),
      projectId: project.id,
      ownerId: project.id,
      intentId: randomUUID(),
      checkpoint: 'metadata-only-lock-check',
      locks,
      cost: {
        ramBytes: 0,
        cpuMillis: 0,
        model: 0,
        environment: 0,
        build: 0,
        review: 0,
        diskBytes: {},
      },
    });
  const budget = (): ResourceBudget => ({
    ramBytes: null,
    cpuMillis: null,
    model: null,
    environment: null,
    build: null,
    review: null,
    diskBytes: {},
    accounts: {},
    measuredAt: Date.now(),
    maxAgeMs: 60_000,
  });
  return {
    db,
    resource,
    request,
    budget,
    lock: { resourceId: resource.id, generation: 1, mode: 'shared' as const },
  };
}

it('atomically excludes new admission, previously unbound bind, generation changes and non-owner mutations', async () => {
  const { db, resource, request, budget, lock } = await currentRepositoryLedger();
  let finish!: () => void;
  const boundary = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const unbound = request();
  const granted = db.admission.admit(unbound.projectId, unbound.id, unbound.revision, budget());
  const running = db.resources.cleanup.run(resource, 'exact-removal', async () => {
    db.resources.cleanup.effect(resource.id);
    await boundary;
    const current = db.resources.get(resource.id)!;
    db.resources.update(current.id, current.revision, { state: 'released' });
  });
  try {
    expect(() =>
      db.resources.register({
        projectId: resource.projectId,
        kind: 'worktree',
        identity: { path: dirname(resource.identity.path!) },
        owner: resource.owner,
        purpose: 'worktree',
        ownership: 'registered',
        preservation: 'disposable',
        generation: 1,
        consumers: [],
        state: 'available',
      }),
    ).toThrow('overlapping registrations');
    const waiter = request([lock]);
    expect(
      db.admission.admit(waiter.projectId, waiter.id, waiter.revision, budget()),
    ).toMatchObject({ state: 'waiting_resource', reason: 'resource_cleanup_locked' });
    expect(() =>
      db.admission.bind(granted.projectId, granted.id, granted.revision, [lock]),
    ).toThrow('cleanup excludes binding');
    expect(() =>
      db.resources.update(resource.id, resource.revision, {
        consumers: [{ id: 'new-access', kind: 'preview', generation: 1 }],
      }),
    ).toThrow('cleanup excludes');
    expect(() =>
      db.resources.update(resource.id, resource.revision, { state: 'released' }),
    ).toThrow('cleanup excludes');
    expect(() => db.resources.cleanup.externalSettled(resource.id)).toThrow(
      'exclusive execution context',
    );
    await expect(
      db.resources.cleanup.run(resource, 'exact-removal', async () => undefined),
    ).rejects.toThrow('live or unverified execution');
  } finally {
    finish();
    await running;
    expect(db.resources.cleanup.read(resource.id)).toBeUndefined();
    db.close();
  }
});

it('retains partial-effect exclusion and only the exact settled operation can retry', async () => {
  const { db, resource } = await currentRepositoryLedger();
  try {
    await expect(
      db.resources.cleanup.run(resource, 'exact-removal', async () => {
        db.resources.cleanup.effect(resource.id);
        expect(() =>
          db.resources.update(resource.id, resource.revision, {
            consumers: [{ id: 'new-owner-access', kind: 'preview', generation: 1 }],
          }),
        ).toThrow('cannot admit new consumers');
        throw new Error('Metadata operation stopped after its effect barrier');
      }),
    ).rejects.toThrow('stopped after');
    expect(db.resources.cleanup.read(resource.id)).toMatchObject({
      state: 'retry',
      externalPending: false,
    });
    await expect(
      db.resources.cleanup.run(resource, 'different-removal', async () => undefined),
    ).rejects.toThrow('another operation or generation');
    await db.resources.cleanup.run(resource, 'exact-removal', async () => {
      const current = db.resources.get(resource.id)!;
      db.resources.update(current.id, current.revision, { state: 'released' });
    });
    expect(db.resources.cleanup.read(resource.id)).toBeUndefined();
    const released = db.resources.get(resource.id)!;
    expect(
      db.resources.update(resource.id, released.revision, { generation: 2, state: 'available' })
        .generation,
    ).toBe(2);
  } finally {
    db.close();
  }
});

it('never clears an ambiguous external executor fence merely because the action rejected', async () => {
  const { db, resource, request, budget, lock } = await currentRepositoryLedger();
  try {
    await expect(
      db.resources.cleanup.run(resource, 'external-removal', async () => {
        db.resources.cleanup.effect(resource.id, true);
        throw new Error('External completion unknown');
      }),
    ).rejects.toThrow('completion unknown');
    expect(db.resources.cleanup.read(resource.id)).toMatchObject({
      state: 'retry',
      externalPending: true,
    });
    await expect(
      db.resources.cleanup.run(resource, 'external-removal', async () => undefined),
    ).rejects.toThrow('executor is unverified');
    const waiter = request([lock]);
    expect(db.admission.admit(waiter.projectId, waiter.id, waiter.revision, budget()).reason).toBe(
      'resource_cleanup_locked',
    );
  } finally {
    db.close();
  }
});

it('permits verified nonterminal maintenance only under its exact held exclusive lease', async () => {
  const { db, resource, request, budget, lock } = await currentRepositoryLedger();
  try {
    const pending = request([{ ...lock, mode: 'exclusive' }]);
    const held = db.admission.admit(pending.projectId, pending.id, pending.revision, budget());
    const current = db.resources.get(resource.id)!;
    await expect(
      db.resources.cleanup.run(current, 'maintenance', async () => undefined),
    ).rejects.toThrow('consumers changed');
    await db.resources.cleanup.runLeased(current, 'maintenance', held, async () => {
      expect(db.resources.cleanup.read(resource.id)?.authorityLeaseId).toBe(held.id);
      db.resources.cleanup.effect(resource.id, true);
      db.resources.cleanup.externalSettled(resource.id);
      db.resources.cleanup.reconciled(resource.id);
    });
    expect(db.resources.cleanup.read(resource.id)).toBeUndefined();
    expect(db.resources.get(resource.id)).toMatchObject({ state: 'available', generation: 1 });
    expect(db.admission.get(held.projectId, held.id)?.state).toBe('granted');
    const retained = db.admission.retain(held.projectId, held.id, held.revision);
    await expect(
      db.resources.cleanup.runLeased(
        db.resources.get(resource.id)!,
        'next-maintenance',
        retained,
        async () => undefined,
      ),
    ).rejects.toThrow('current exact exclusive lease');
    db.admission.release(
      retained.projectId,
      retained.id,
      retained.revision,
      { [resource.id]: 1 },
      'Metadata maintenance executor settled',
    );
    expect(db.resources.get(resource.id)?.consumers).toEqual([]);
  } finally {
    db.close();
  }
});

it('fails closed for malformed persisted exclusion metadata', async () => {
  const { db, resource, request, budget, lock } = await currentRepositoryLedger();
  try {
    db.setSetting(`resource.cleanup.fence.${resource.id}`, { resourceId: resource.id });
    expect(() => db.resources.cleanup.read(resource.id)).toThrow(
      'Malformed resource cleanup fence',
    );
    const waiter = request([lock]);
    expect(() =>
      db.admission.admit(waiter.projectId, waiter.id, waiter.revision, budget()),
    ).toThrow('Malformed resource cleanup fence');
  } finally {
    db.close();
  }
});
