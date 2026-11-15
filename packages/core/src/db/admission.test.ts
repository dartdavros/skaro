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
      'admitted',
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

it('ignores exhausted, unknown and stale capacity, while a stopped intent stays stopped', async () => {
  const root = await realpath(process.cwd());
  const db = AppDb.open(':memory:');
  try {
    const request = (id: string) =>
      db.admission.request({
        id,
        projectId: root,
        ownerId: root,
        intentId: id,
        checkpoint: 'current_repository_observation',
        account: 'account',
        locks: [],
        cost: {
          ramBytes: 1,
          cpuMillis: 1,
          model: 1,
          environment: 1,
          build: 1,
          review: 1,
          diskBytes: { disk: 1 },
          pools: { dockerDiskBytes: 1 },
        },
      });
    const budget: ResourceBudget = {
      ramBytes: null,
      cpuMillis: null,
      model: 0,
      environment: 0,
      build: 0,
      review: 0,
      diskBytes: {},
      pools: {},
      accounts: { account: { slots: 0, blocked: true } },
      measuredAt: 0,
      maxAgeMs: 1,
    };
    const older = request('older');
    const newer = request('newer');
    // An older queued or retained owner cannot consume unrelated capacity or impose FIFO.
    const granted = db.admission.admit(root, newer.id, newer.revision, budget);
    expect(granted.state).toBe('granted');
    expect(db.admission.admit(root, older.id, older.revision, budget).state).toBe('granted');
    const pending = request('stopped');
    const stopped = db.admission.stop(root, pending.id, pending.revision);
    expect(db.admission.admit(root, stopped.id, stopped.revision, budget).state).toBe(
      'stopped_by_owner',
    );
    expect(() =>
      db.admission.request({
        ...request('invalid'),
        id: 'invalid-cost',
        cost: { ...pending.cost, cpuMillis: -1 },
      }),
    ).toThrow('Invalid resource admission request');
  } finally {
    db.close();
  }
});
