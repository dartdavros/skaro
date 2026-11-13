import { realpath, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { AppDb } from './appdb.ts';
import type { ResourceBudget, ResourceCost } from '../resources/admission-model.ts';

it('charges Docker disk reservations to their actual host filesystem as well as the VM pool', async () => {
  const root = await realpath(process.cwd());
  const info = await stat(join(root, 'package.json'));
  const volume = String(info.dev);
  const db = AppDb.open(':memory:');
  try {
    const cost: ResourceCost = {
      ramBytes: 0,
      cpuMillis: 0,
      model: 0,
      environment: 1,
      build: 0,
      review: 0,
      diskBytes: { [volume]: info.size },
      pools: { dockerDiskBytes: info.size },
    };
    const budget: ResourceBudget = {
      ...cost,
      accounts: {},
      measuredAt: Date.now(),
      maxAgeMs: 60000,
      poolVolumes: { dockerDiskBytes: volume },
    };
    const request = db.admission.request({
      id: randomUUID(),
      projectId: root,
      ownerId: root,
      intentId: randomUUID(),
      checkpoint: 'disk_observation',
      cost,
      locks: [],
    });
    const waiting = db.admission.admit(root, request.id, request.revision, budget);
    expect(waiting.reason).toBe('budget_disk');
    const host = db.admission.request({
      id: randomUUID(),
      projectId: root,
      ownerId: root,
      intentId: randomUUID(),
      checkpoint: 'host_disk_observation',
      cost: { ...cost, environment: 0, pools: {} },
      locks: [],
    });
    expect(db.admission.admit(root, host.id, host.revision, budget).reason).toBe('older_request');
    expect(
      db.admission.admit(root, request.id, waiting.revision, {
        ...budget,
        diskBytes: { [volume]: info.size * 2 },
      }).state,
    ).toBe('granted');
  } finally {
    db.close();
  }
});

it('conserves split reservations, binds a real observation and cancels without reviving an old grant', async () => {
  const root = await realpath(process.cwd());
  const bytes = (await stat(join(root, 'package.json'))).size;
  const db = AppDb.open(':memory:');
  try {
    const cost: ResourceCost = {
      ramBytes: bytes,
      cpuMillis: 0,
      model: 0,
      environment: 0,
      build: 1,
      review: 1,
      diskBytes: {},
      pools: { observation: bytes },
    };
    const budget: ResourceBudget = {
      ...cost,
      ramBytes: bytes * 3,
      build: 1,
      review: 3,
      accounts: {},
      measuredAt: Date.now(),
      maxAgeMs: 60000,
    };
    const request = (value: ResourceCost) =>
      db.admission.request({
        id: randomUUID(),
        projectId: root,
        ownerId: root,
        intentId: randomUUID(),
        checkpoint: 'filesystem_observation',
        cost: value,
        locks: [],
      });
    const original = request(cost);
    const unknown = db.admission.admit(root, original.id, original.revision, {
      ...budget,
      pools: {},
    });
    expect(unknown.reason).toBe('unknown_pool:observation');
    const granted = db.admission.admit(root, original.id, unknown.revision, budget);
    const work = { ...cost, review: 0 };
    const view = { ...cost, ramBytes: 0, build: 0, pools: {} };
    expect(() =>
      db.admission.split(root, granted.id, granted.revision, [
        { checkpoint: 'work', cost },
        { checkpoint: 'review', cost },
      ]),
    ).toThrow('conserve');
    expect(db.admission.get(root, granted.id)).toEqual(granted);
    const [worker, review] = db.admission.split(root, granted.id, granted.revision, [
      { checkpoint: 'work', cost: work },
      { checkpoint: 'review', cost: view },
    ]);
    expect(db.admission.get(root, granted.id)?.state).toBe('released');
    expect(() =>
      db.admission.split(root, granted.id, granted.revision, [
        { checkpoint: 'work', cost: work },
        { checkpoint: 'review', cost: view },
      ]),
    ).toThrow('revision');
    const resource = db.resources.register({
      projectId: root,
      kind: 'worktree',
      identity: { path: root },
      owner: { kind: 'unknown', id: root },
      purpose: 'unknown',
      ownership: 'legacy-unverified',
      preservation: 'unknown',
      generation: 1,
      consumers: [],
      state: 'retained',
    });
    const bound = db.admission.bind(root, review!.id, review!.revision, [
      { resourceId: resource.id, generation: resource.generation, mode: 'shared' },
    ]);
    expect(db.resources.get(resource.id)?.consumers.map((item) => item.id)).toEqual([
      `lease:${bound.id}`,
    ]);
    db.admission.release(root, worker!.id, worker!.revision, {}, 'observation_work_finished');
    expect(db.admission.get(root, bound.id)?.state).toBe('granted');
    const held = db.resources.get(resource.id)!;
    expect(() =>
      db.resources.update(held.id, held.revision, { generation: 2, consumers: [] }),
    ).toThrow();
    const stopped = db.admission.stop(root, bound.id, bound.revision);
    db.admission.release(
      root,
      bound.id,
      stopped.revision,
      { [resource.id]: 1 },
      'observation_finished',
    );
    expect(db.admission.get(root, bound.id)?.state).toBe('stopped_by_owner');
    const pending = request(cost);
    const cancelled = db.admission.cancel(
      root,
      pending.id,
      pending.revision,
      'restart_requires_readmission',
    );
    expect(db.admission.stop(root, pending.id, cancelled.revision)).toEqual(cancelled);
    expect(db.admission.admit(root, pending.id, cancelled.revision, budget)).toEqual(cancelled);
  } finally {
    db.close();
  }
});

it('keeps FIFO for competing builds while an admitted worker obtains an independent preview slot', async () => {
  const root = await realpath(process.cwd());
  const db = AppDb.open(':memory:');
  try {
    const cost: ResourceCost = {
      ramBytes: 0,
      cpuMillis: 0,
      model: 0,
      environment: 0,
      build: 1,
      review: 0,
      diskBytes: {},
    };
    const budget: ResourceBudget = {
      ...cost,
      environment: 1,
      review: 1,
      accounts: {},
      measuredAt: Date.now(),
      maxAgeMs: 60000,
    };
    const request = (value: ResourceCost) =>
      db.admission.request({
        id: randomUUID(),
        projectId: root,
        ownerId: root,
        intentId: randomUUID(),
        checkpoint: 'observation',
        cost: value,
        locks: [],
      });
    const first = request(cost);
    const running = db.admission.admit(root, first.id, first.revision, budget);
    const second = request(cost);
    const waiting = db.admission.admit(root, second.id, second.revision, budget);
    expect(waiting.reason).toBe('budget_build');
    const preview = request({ ...cost, build: 0, review: 1, environment: 1 });
    expect(db.admission.admit(root, preview.id, preview.revision, budget).state).toBe('granted');
    const third = request(cost);
    db.admission.release(root, running.id, running.revision, {}, 'read_completed');
    expect(db.admission.admit(root, third.id, third.revision, budget).reason).toBe('older_request');
    expect(db.admission.admit(root, waiting.id, waiting.revision, budget).state).toBe('granted');
  } finally {
    db.close();
  }
});
