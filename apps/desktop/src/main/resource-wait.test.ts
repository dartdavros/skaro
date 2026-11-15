import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { resolve } from 'node:path';
import { ResourceManager } from './resource-manager';

it('waits only for the exact ownership lock, preserves Stop, and clears the wait on release', async () => {
  const db = AppDb.open(':memory:');
  const root = resolve('.');
  const project = db.addProject({ name: 'Current repository lock observation', path: root });
  const resource = db.resources.register({
    projectId: project.id,
    kind: 'worktree',
    identity: { path: root },
    owner: { kind: 'project', id: project.id },
    purpose: 'worktree',
    ownership: 'registered',
    preservation: 'persistent',
    generation: 1,
    consumers: [],
    state: 'available',
  });
  const manager = new ResourceManager(db, () => {});
  const request = (id: string) => ({
    id,
    projectId: project.id,
    ownerId: id,
    intentId: id,
    checkpoint: 'ownership-observation',
    cost: {
      ramBytes: 0,
      cpuMillis: 0,
      model: 0,
      build: 0,
      review: 0,
      environment: 0,
      diskBytes: {},
    },
    locks: [{ resourceId: resource.id, generation: 1, mode: 'exclusive' as const }],
  });
  const current = { signal: new AbortController().signal, requireCurrent: () => {} };
  try {
    const first = await manager.acquire(request('first'), current);
    const stopped = new AbortController();
    const pending = manager.acquire(request('stopped'), { ...current, signal: stopped.signal });
    const rejected = expect(pending).rejects.toThrow('Owner stopped observation');
    await expect.poll(() => manager.waiting(project.id, 'stopped')?.reason).toBe('resource_locked');
    expect(manager.waiting(project.id, 'stopped')?.disks).toEqual([]);
    expect(manager.waiting('other-project', 'stopped')).toBeUndefined();
    stopped.abort(new Error('Owner stopped observation'));
    await rejected;
    const next = manager.acquire(request('next'), current);
    await expect.poll(() => manager.waiting(project.id, 'next')?.reason).toBe('resource_locked');
    manager.release(first, 'first_observation_finished');
    const granted = await next;
    expect(granted.state).toBe('granted');
    expect(manager.waiting(project.id, 'next')).toBeUndefined();
    expect(db.admission.get(project.id, 'stopped')?.state).toBe('stopped_by_owner');
    manager.release(granted, 'next_observation_finished');
    const restarted = new ResourceManager(db, () => {});
    expect(restarted.waiting(project.id, 'next')).toBeUndefined();
    await restarted.close();
  } finally {
    await manager.close();
    db.close();
  }
});
