import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { resolve } from 'node:path';
import { ResourceManager } from './resource-manager';
import { ApplicationResources } from './application-resources';
import { RESOURCE_POLICY_KEY } from './resource-policy';

it('dispatches cache work regardless of a zero configured build capacity', async () => {
  const db = AppDb.open(':memory:');
  const project = db.addProject({
    name: 'Current repository admission metadata',
    path: resolve('.'),
  });
  db.setSetting(RESOURCE_POLICY_KEY, { build: 0 });
  const manager = new ResourceManager(db, (lease) =>
    db.addEvent(lease.projectId, 'resource_admission', {
      id: lease.id,
      state: lease.state,
      reason: lease.reason,
    }),
  );
  try {
    const request = {
      id: 'cache-capacity-check',
      projectId: project.id,
      ownerId: 'cache-host',
      intentId: 'current-intent',
      checkpoint: 'managed-cache-dependencies',
      cost: {
        ramBytes: 0,
        cpuMillis: 0,
        model: 0,
        environment: 0,
        build: 1,
        review: 0,
        diskBytes: {},
      },
      locks: [],
    };
    const lease = await manager.acquire(request, {
      signal: new AbortController().signal,
      wait: false,
      requireCurrent: () => {
        if (!db.getProject(project.id)) throw new Error('project removed');
      },
    });
    expect(lease.state).toBe('granted');
    expect(manager.waiting(project.id, request.ownerId)).toBeUndefined();
    manager.release(lease, 'metadata_observation_finished');
  } finally {
    await manager.close();
    db.close();
  }
});

it('keeps the default admitted path and exact release evidence without measurement prerequisites', async () => {
  const db = AppDb.open(':memory:');
  const project = db.addProject({
    name: 'Current repository default admission',
    path: resolve('.'),
  });
  const manager = new ResourceManager(db, (lease) =>
    db.addEvent(lease.projectId, 'resource_admission', { id: lease.id, state: lease.state }),
  );
  try {
    const lease = await manager.acquire(
      {
        id: 'default-metadata-only',
        projectId: project.id,
        ownerId: 'owner',
        intentId: 'intent',
        checkpoint: 'bounded-metadata',
        cost: {
          ramBytes: 0,
          cpuMillis: 0,
          model: 0,
          environment: 0,
          build: 0,
          review: 0,
          diskBytes: {},
        },
        locks: [],
      },
      {
        signal: new AbortController().signal,
        requireCurrent: () => {
          if (!db.getProject(project.id)) throw new Error('project removed');
        },
      },
    );
    expect(lease.state).toBe('granted');
    manager.release(lease, 'metadata_only_no_external_effect_started');
    expect(db.admission.get(project.id, lease.id)?.state).toBe('released');
  } finally {
    await manager.close();
    db.close();
  }
});

it('retires unstarted leases on restart and admits only a fresh current owner despite cached quota', async () => {
  const db = AppDb.open(':memory:');
  const root = resolve('.');
  const project = db.addProject({ name: 'Current repository restart observation', path: root });
  const request = (id: string) => ({
    id,
    projectId: project.id,
    ownerId: 'owner',
    intentId: id,
    account: 'account',
    checkpoint: 'model',
    cost: {
      ramBytes: 1,
      cpuMillis: 1,
      model: 1,
      environment: 1,
      build: 1,
      review: 1,
      diskBytes: {},
    },
    locks: [],
  });
  const old = db.admission.request(request('old-waiter'));
  const stopped = db.admission.request(request('stopped-owner'));
  db.admission.stop(project.id, stopped.id, stopped.revision);
  db.setSetting('resources.accountLimits', { account: { exhausted: true } });
  db.setSetting(RESOURCE_POLICY_KEY, { model: 0, environment: 0, build: 0, review: 0 });
  const resources = new ApplicationResources(db, root);
  try {
    expect(db.admission.get(project.id, old.id)?.state).toBe('cancelled');
    expect(db.admission.get(project.id, stopped.id)?.state).toBe('stopped_by_owner');
    const lease = await resources.manager.acquire(request('fresh-intent'), {
      signal: new AbortController().signal,
      requireCurrent: () => {
        if (!db.getProject(project.id)) throw new Error('Project removed');
      },
    });
    expect(lease.state).toBe('granted');
    resources.manager.release(lease, 'metadata_observation_finished');
    expect(db.admission.get(project.id, old.id)?.state).toBe('cancelled');
    expect(db.admission.get(project.id, stopped.id)?.state).toBe('stopped_by_owner');
  } finally {
    await resources.close();
    db.close();
  }
});
