import { expect, it } from 'vitest';
import { AppDb, type ResourceLease, type ResourceBudget } from '@skaro/core';
import { statfs } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ResourceManager } from './resource-manager';
import { measureResourceBudget, resourceVolume } from './resource-budget';
import { applicationResourcePolicy } from './resource-policy';
import { resourceWait } from './resource-wait';

it('reports an actual disk admission wait before dispatch, clears on admission and ignores old waits', async () => {
  const db = AppDb.open(':memory:');
  const root = resolve('.');
  const project = db.addProject({ name: 'Disk admission regression', path: root });
  const fs = await statfs(root, { bigint: true });
  const volume = await resourceVolume(root);
  const policy = applicationResourcePolicy(db);
  policy.reserveDiskBytes = Number(fs.bavail * fs.bsize) + 1024 ** 3;
  const manager = new ResourceManager(
    db,
    () => measureResourceBudget(policy, [root]),
    () => {},
  );
  const controller = new AbortController();
  let changes = 0;
  const pending = manager.acquire(
    {
      id: 'disk-wait',
      projectId: project.id,
      ownerId: 'task:T-001',
      intentId: 'disk-wait',
      checkpoint: 'process:disk-wait',
      cost: {
        ramBytes: 0,
        cpuMillis: 0,
        model: 0,
        build: 0,
        review: 0,
        environment: 0,
        diskBytes: { [volume]: 1024 ** 2 },
      },
      locks: [],
    },
    {
      signal: controller.signal,
      requireCurrent: () => {},
      changed: () => {
        changes++;
      },
    },
  );
  void pending.catch(() => {});
  try {
    await expect.poll(() => manager.waiting(project.id, 'task:T-001')?.reason).toBe('budget_disk');
    const wait = manager.waiting(project.id, 'task:T-001')!;
    expect(wait.disks).toMatchObject([
      { requested: 1024 ** 2, available: 0, reserve: policy.reserveDiskBytes },
    ]);
    expect(wait.disks[0]!.free).toBeGreaterThan(0);
    expect(wait.disks[0]!.path).not.toBe(volume);
    expect(manager.waiting('other-project', 'task:T-001')).toBeUndefined();
    expect(changes).toBeGreaterThan(0);
    policy.reserveDiskBytes = 0;
    manager.poke();
    const lease = await pending;
    expect(lease.state).toBe('granted');
    expect(manager.waiting(project.id, 'task:T-001')).toBeUndefined();
    manager.release(lease, 'regression_completed');
    const restarted = new ResourceManager(
      db,
      () => measureResourceBudget(policy, [root]),
      () => {},
    );
    expect(restarted.waiting(project.id, 'task:T-001')).toBeUndefined();
    await restarted.close();
  } finally {
    controller.abort();
    await pending.catch(() => {});
    await manager.close();
    db.close();
  }
});

it('explains shared host and Docker disk reservations and never turns unknown capacity into zero', () => {
  const cost = { ramBytes: 0, cpuMillis: 0, model: 0, build: 0, review: 0, environment: 0 };
  const row: ResourceLease = {
    id: 'wait',
    projectId: 'project',
    ownerId: 'owner',
    intentId: 'intent',
    checkpoint: 'model',
    cost: { ...cost, diskBytes: { disk: 60 } },
    locks: [],
    revision: 1,
    sequence: 2,
    state: 'waiting_resource',
    reason: 'budget_disk',
    createdAt: 100,
    updatedAt: 200,
  };
  const holder: ResourceLease = {
    ...row,
    id: 'holder',
    state: 'granted',
    cost: { ...cost, diskBytes: { disk: 10 }, pools: { dockerDiskBytes: 40 } },
  };
  const budget: ResourceBudget = {
    ...cost,
    diskBytes: { disk: 100 },
    disks: { disk: { path: 'C:\\', freeBytes: 1100, reserveBytes: 1000 } },
    poolVolumes: { dockerDiskBytes: 'disk' },
    measuredAt: 200,
    maxAgeMs: 5000,
    accounts: {},
  };
  expect(resourceWait(row, budget, [row, holder])).toMatchObject({
    since: 100,
    disks: [
      { path: 'C:\\', requested: 60, reserved: 50, available: 100, free: 1100, reserve: 1000 },
    ],
  });
  expect(
    resourceWait({ ...row, reason: 'unknown_disk' }, undefined, [row]).disks[0]?.available,
  ).toBeUndefined();
});
