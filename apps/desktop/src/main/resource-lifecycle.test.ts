import { expect, it } from 'vitest';
import { realpath } from 'node:fs/promises';
import { AppDb } from '@skaro/core';
import { ResourceLifecycle, type LifecycleStep } from './resource-lifecycle';

it('journals real ledger effects, re-verifies retries, serializes callers and rejects stale generations', async () => {
  const db = AppDb.open(':memory:');
  try {
    const path = await realpath(process.cwd());
    const project = db.addProject({ name: 'Skaro', path });
    const resource = db.resources.register({
      projectId: project.id,
      identity: { path },
      kind: 'worktree',
      owner: { kind: 'unknown', id: path },
      purpose: 'unknown',
      preservation: 'unknown',
      ownership: 'legacy-unverified',
      generation: 1,
      consumers: [],
      state: 'retained',
    });
    const lifecycle = new ResourceLifecycle(db);
    const action = {
      guard: () => {
        expect(db.resources.get(resource.id)?.generation).toBe(1);
      },
      verify: () => db.resources.get(resource.id)?.state === 'released',
      execute: () => {
        expect(lifecycle.read(resource, 'ledger.release')?.state).toBe('running');
        const current = db.resources.get(resource.id)!;
        db.resources.update(resource.id, current.revision, { state: 'released' });
      },
    };
    await Promise.all([
      lifecycle.run(resource, 'ledger.release', action),
      lifecycle.run(resource, 'ledger.release', action),
    ]);
    const verified = lifecycle.read(resource, 'ledger.release');
    expect(verified).toMatchObject({ state: 'verified', attempts: 1 });
    await new ResourceLifecycle(db).run(resource, 'ledger.release', action);
    expect(lifecycle.read(resource, 'ledger.release')).toEqual(verified);
    const current = db.resources.get(resource.id)!;
    db.resources.update(current.id, current.revision, { state: 'available', generation: 2 });
    await expect(lifecycle.run(resource, 'ledger.release', action)).rejects.toThrow(
      'generation changed',
    );
    expect(db.resources.get(resource.id)?.state).toBe('available');
    expect(lifecycle.read(resource, 'ledger.release')?.state).toBe('failed');
  } finally {
    db.close();
  }
});

it('persists a rejected real ledger mutation without claiming verified success', async () => {
  const db = AppDb.open(':memory:');
  try {
    const path = await realpath(process.cwd());
    const project = db.addProject({ name: 'Skaro', path });
    const resource = db.resources.register({
      projectId: project.id,
      identity: { path },
      kind: 'worktree',
      owner: { kind: 'unknown', id: path },
      purpose: 'unknown',
      preservation: 'unknown',
      ownership: 'legacy-unverified',
      generation: 1,
      consumers: [],
      state: 'retained',
    });
    const lifecycle = new ResourceLifecycle(db);
    await expect(
      lifecycle.run(resource, 'ledger.release', {
        guard: () => undefined,
        verify: () => db.resources.get(resource.id)?.state === 'released',
        execute: () => {
          db.resources.update(resource.id, resource.revision + 1, { state: 'released' });
        },
      }),
    ).rejects.toThrow('revision changed');
    expect(lifecycle.read(resource, 'ledger.release')).toMatchObject({
      state: 'failed',
      attempts: 1,
    });
    expect(db.resources.get(resource.id)?.state).toBe('retained');
  } finally {
    db.close();
  }
});

it('never overwrites a newer checkpoint from a stale failure and reads legacy rows only for their generation', async () => {
  const db = AppDb.open(':memory:');
  try {
    const path = await realpath(process.cwd());
    const project = db.addProject({ name: 'Skaro', path });
    const first = db.resources.register({
      projectId: project.id,
      identity: { path },
      kind: 'worktree',
      owner: { kind: 'unknown', id: path },
      purpose: 'unknown',
      preservation: 'unknown',
      ownership: 'legacy-unverified',
      generation: 1,
      consumers: [],
      state: 'released',
    });
    const legacyKey = `resource.lifecycle.${first.id}.release`;
    const legacy: LifecycleStep = {
      id: 'legacy-operation',
      resourceId: first.id,
      generation: 1,
      step: 'release',
      state: 'verified',
      attempts: 1,
      updatedAt: Date.now(),
    };
    db.setSetting(legacyKey, legacy);
    const lifecycle = new ResourceLifecycle(db);
    expect(lifecycle.read(first, 'release')).toEqual(legacy);
    const second = db.resources.update(first.id, first.revision, {
      generation: 2,
      state: 'available',
    });
    expect(lifecycle.read(second, 'release')).toBeUndefined();
    const action = {
      guard: () => undefined,
      verify: () => db.resources.get(second.id)?.state === 'released',
      execute: () => {
        const current = db.resources.get(second.id)!;
        db.resources.update(current.id, current.revision, { state: 'released' });
      },
    };
    await lifecycle.run(second, 'release', action);
    const newer = lifecycle.read(second, 'release');
    expect(newer).toMatchObject({ generation: 2, state: 'verified', attempts: 1 });
    await expect(new ResourceLifecycle(db).run(first, 'release', action)).rejects.toThrow(
      'generation changed',
    );
    expect(lifecycle.read(second, 'release')).toEqual(newer);
    expect(db.getSetting(legacyKey, undefined)).toEqual(legacy);
    expect(lifecycle.read(first, 'release')).toMatchObject({ generation: 1, state: 'failed' });
  } finally {
    db.close();
  }
});

it('does not verify or execute a generation replaced during the awaited guard', async () => {
  const db = AppDb.open(':memory:');
  try {
    const path = await realpath(process.cwd());
    const project = db.addProject({ name: 'Skaro', path });
    const resource = db.resources.register({
      projectId: project.id,
      identity: { path },
      kind: 'worktree',
      owner: { kind: 'unknown', id: path },
      purpose: 'unknown',
      preservation: 'unknown',
      ownership: 'legacy-unverified',
      generation: 1,
      consumers: [],
      state: 'released',
    });
    const lifecycle = new ResourceLifecycle(db);
    await expect(
      lifecycle.run(resource, 'release', {
        guard: async () => {
          await Promise.resolve();
          db.resources.update(resource.id, resource.revision, {
            generation: 2,
            state: 'available',
          });
        },
        verify: () => {
          throw new Error('Stale verification must not run');
        },
        execute: () => {
          throw new Error('Stale effect must not run');
        },
      }),
    ).rejects.toThrow('generation changed');
    expect(db.resources.get(resource.id)).toMatchObject({ generation: 2, state: 'available' });
    expect(lifecycle.read(resource, 'release')).toMatchObject({
      generation: 1,
      state: 'failed',
      attempts: 0,
    });
    expect(lifecycle.read(db.resources.get(resource.id)!, 'release')).toBeUndefined();
  } finally {
    db.close();
  }
});
