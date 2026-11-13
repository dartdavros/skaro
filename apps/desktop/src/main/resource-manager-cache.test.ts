import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { resolve } from 'node:path';
import { ResourceManager, ResourceAdmissionUnavailable } from './resource-manager';
import { applicationResourceMeasurements } from './resource-measurements';
import { RESOURCE_POLICY_KEY } from './resource-policy';

it('cancels only the still-waiting cache request after one actual host/SQLite admission decision', async () => {
  const db = AppDb.open(':memory:');
  const project = db.addProject({
    name: 'Current repository admission metadata',
    path: resolve('.'),
  });
  db.setSetting(RESOURCE_POLICY_KEY, { build: 0 });
  const manager = new ResourceManager(
    db,
    () => applicationResourceMeasurements(db, new Set(), new Set([resolve('.')]), false),
    (lease) =>
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
    await expect(
      manager.acquire(request, {
        signal: new AbortController().signal,
        wait: false,
        requireCurrent: () => {
          if (!db.getProject(project.id)) throw new Error('project removed');
        },
      }),
    ).rejects.toMatchObject({
      name: 'Error',
      message: 'resource_admission_unavailable',
      reason: 'budget_build',
    } satisfies Partial<ResourceAdmissionUnavailable>);
    const current = db.admission.get(project.id, request.id)!;
    expect(current.state).toBe('cancelled');
    expect(current.reason).toBe('budget_build');
    expect(db.admission.all().some((x) => ['granted', 'retained'].includes(x.state))).toBe(false);
  } finally {
    await manager.close();
    db.close();
  }
});

it('keeps the default admitted path and exact release evidence unchanged with real measurements', async () => {
  const db = AppDb.open(':memory:');
  const project = db.addProject({
    name: 'Current repository default admission',
    path: resolve('.'),
  });
  const manager = new ResourceManager(
    db,
    () => applicationResourceMeasurements(db, new Set(), new Set([resolve('.')]), false),
    (lease) =>
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
