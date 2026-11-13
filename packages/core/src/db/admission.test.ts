import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, stat, rm } from 'node:fs/promises';
import { tmpdir, freemem } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { AppDb } from './appdb.ts';
import type { ResourceBudget, ResourceLeaseRequest } from '../resources/admission-model.ts';

it('serializes real observation leases across handles, preserves consumers and fences stale releases after reopen', async () => {
  const root = await realpath(process.cwd());
  const bytes = (await stat(join(root, 'package.json'))).size;
  expect(freemem()).toBeGreaterThan(bytes * 2);
  const directory = await mkdtemp(join(tmpdir(), 'skaro-admission-'));
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('skaro-admission-')
  )
    throw new Error('Unexpected test directory');
  const file = join(directory, 'ledger.sqlite');
  const db = AppDb.open(file);
  let other = AppDb.open(file);
  try {
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
    const input: ResourceLeaseRequest = {
      id: randomUUID(),
      projectId: root,
      ownerId: root,
      intentId: randomUUID(),
      checkpoint: 'filesystem_observation',
      cost: {
        ramBytes: bytes,
        cpuMillis: 0,
        model: 0,
        environment: 0,
        build: 0,
        review: 1,
        diskBytes: {},
      },
      locks: [{ resourceId: resource.id, generation: resource.generation, mode: 'shared' }],
    };
    const budget: ResourceBudget = {
      ...input.cost,
      ramBytes: bytes * 2,
      review: 2,
      measuredAt: Date.now(),
      maxAgeMs: 60000,
      accounts: {},
    };
    const initial = db.admission.request(input);
    expect(other.admission.request(input)).toEqual(initial);
    const first = other.admission.admit(root, initial.id, initial.revision, budget);
    expect(first.state).toBe('granted');
    expect(db.admission.admit(root, first.id, first.revision, budget)).toEqual(first);
    const secondInput = { ...input, id: randomUUID(), intentId: randomUUID() };
    const second = db.admission.request(secondInput);
    const held = db.admission.admit(root, second.id, second.revision, budget);
    expect(held.state).toBe('granted');
    const record = db.resources.get(resource.id)!;
    expect(record.consumers).toHaveLength(2);
    expect(() => db.resources.update(record.id, record.revision, { consumers: [] })).toThrow(
      'leases',
    );
    const exclusive = db.admission.request({
      ...input,
      id: randomUUID(),
      locks: [{ ...input.locks[0]!, mode: 'exclusive' }],
    });
    expect(db.admission.admit(root, exclusive.id, exclusive.revision, budget).reason).toBe(
      'resource_locked',
    );
    const waiting = db.admission.request({
      ...input,
      id: randomUUID(),
      projectId: await realpath(dirname(root)),
      locks: [],
    });
    expect(db.admission.admit(waiting.projectId, waiting.id, waiting.revision, budget).reason).toBe(
      'budget_ramBytes',
    );
    expect(() =>
      db.admission.release(
        root,
        first.id,
        first.revision,
        { [resource.id]: 2 },
        'observation_finished',
      ),
    ).toThrow('generation');
    other.close();
    other = AppDb.open(file);
    expect(other.admission.get(root, first.id)?.state).toBe('granted');
    const retained = other.admission.stop(root, first.id, first.revision);
    expect(retained.state).toBe('retained');
    expect(other.admission.admit(root, retained.id, retained.revision, budget)).toEqual(retained);
    const stopped = other.admission.release(
      root,
      retained.id,
      retained.revision,
      { [resource.id]: 1 },
      'filesystem_observation_ended',
    );
    expect(stopped.state).toBe('stopped_by_owner');
    expect(db.resources.get(resource.id)?.consumers.map((c) => c.id)).toEqual([`lease:${held.id}`]);
    expect(() =>
      db.admission.release(
        root,
        held.id,
        held.revision - 1,
        { [resource.id]: 1 },
        'observation_ended',
      ),
    ).toThrow('revision');
    const released = db.admission.release(
      root,
      held.id,
      held.revision,
      { [resource.id]: 1 },
      'filesystem_observation_ended',
    );
    expect(released.state).toBe('released');
    expect(db.resources.get(resource.id)?.consumers).toEqual([]);
    expect(db.listProjects()).toEqual([]);
  } finally {
    db.close();
    other.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps unknown budgets and quota closed, honors FIFO and never resumes a stopped intent', async () => {
  const root = await realpath(process.cwd());
  const bytes = (await stat(join(root, 'package.json'))).size;
  const db = AppDb.open(':memory:');
  try {
    const input: ResourceLeaseRequest = {
      id: randomUUID(),
      projectId: root,
      ownerId: root,
      intentId: randomUUID(),
      checkpoint: 'package_observation',
      locks: [],
      cost: {
        ramBytes: bytes,
        cpuMillis: 0,
        model: 0,
        environment: 0,
        build: 1,
        review: 0,
        diskBytes: {},
      },
    };
    const budget: ResourceBudget = {
      ...input.cost,
      measuredAt: Date.now(),
      maxAgeMs: 60000,
      accounts: {},
    };
    const older = db.admission.request({ ...input, cost: { ...input.cost, ramBytes: bytes * 2 } });
    expect(db.admission.admit(root, older.id, older.revision, budget).reason).toBe(
      'budget_ramBytes',
    );
    const newer = db.admission.request({ ...input, id: randomUUID() });
    const queued = db.admission.admit(root, newer.id, newer.revision, budget);
    expect(queued.reason).toBe('older_request');
    const stop = db.admission.stop(root, older.id, db.admission.get(root, older.id)!.revision);
    expect(
      db.admission.admit(root, older.id, stop.revision, { ...budget, ramBytes: bytes * 3 }).state,
    ).toBe('stopped_by_owner');
    const unknown = db.admission.admit(root, newer.id, queued.revision, {
      ...budget,
      ramBytes: null,
    });
    expect(unknown.reason).toBe('unknown_ramBytes');
    const granted = db.admission.admit(root, newer.id, unknown.revision, budget);
    expect(granted.state).toBe('granted');
    const model = db.admission.request({
      ...input,
      id: randomUUID(),
      account: 'observation-only',
      cost: { ...input.cost, model: 1 },
    });
    expect(db.admission.admit(root, model.id, model.revision, budget).state).toBe('waiting_quota');
    const availableAccount = {
      ...budget,
      model: 2,
      accounts: { 'observation-only': { slots: 2, blocked: false } },
    };
    const light = db.admission.request({
      ...input,
      id: randomUUID(),
      account: 'observation-only',
      cost: { ...input.cost, model: 1, ramBytes: 0, build: 0 },
    });
    const deferred = db.admission.admit(root, light.id, light.revision, availableAccount);
    expect(deferred.reason).toBe('older_request');
    db.admission.stop(root, model.id, db.admission.get(root, model.id)!.revision);
    // The existing build consumes RAM/build, but a model slot is an independent capacity.
    expect(db.admission.admit(root, light.id, deferred.revision, availableAccount).state).toBe(
      'granted',
    );
    expect(() =>
      db.admission.request({ ...input, cost: { ...input.cost, ramBytes: -1 } }),
    ).toThrow();
  } finally {
    db.close();
  }
});
