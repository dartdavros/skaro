import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { join, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { artifactMetadata, builderMetadata, cacheProcessAbsent } from './managed-cache-metadata';
import {
  ManagedCacheStore,
  DEPENDENCY_RECOVERY,
  PNPM_DEPENDENCY_RECOVERY,
  type ManagedArtifact,
} from './managed-cache-store';
import { managedTaskDirectory } from './managed-cache-tools';
import { canonicalCachePath, cacheTree } from './managed-cache-files';
import { dependencyPhaseUnsettled } from './managed-cache-lifetime';
import { ManagedDependencyMaintenance } from './managed-dependency-maintenance';

it('rejects corrupted, duplicate and unproven immutable metadata', () => {
  const entry: ManagedArtifact = {
    key: 'a'.repeat(64),
    projectId: 'p',
    resourceId: `resource-${'b'.repeat(64)}`,
    generation: 1,
    state: 'ready',
    immutable: true,
    digest: 'c'.repeat(64),
    bytes: 100,
    expandedBytes: 200,
    expandedFiles: 2,
    usedAt: 1,
  };
  expect(artifactMetadata([entry])).toEqual([entry]);
  for (const input of [
    [entry, entry],
    [{ ...entry, digest: undefined }],
    [{ ...entry, bytes: -1 }],
    [{ ...entry, key: '../foreign' }],
    [{ ...entry, immutable: 'true' }],
  ])
    expect(() => artifactMetadata(input)).toThrow('metadata');
  expect(() => builderMetadata([{ projectId: 'p', name: 'default' }])).toThrow('metadata');
  expect(cacheProcessAbsent(process.pid)).toBe(false);
});

it('binds persisted artifact generations to exact SQLite resource ownership and deduplicates outcomes', async () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Metadata ownership', path: resolve('.') });
    const store = new ManagedCacheStore(db, resolve('.'));
    const key = 'a'.repeat(64),
      resource = store.resource(project.id, store.path(key), DEPENDENCY_RECOVERY, key);
    const entry: ManagedArtifact = {
      key,
      projectId: project.id,
      resourceId: resource.id,
      generation: resource.generation,
      state: 'ready',
      immutable: true,
      digest: 'b'.repeat(64),
      bytes: 0,
      expandedBytes: 0,
      expandedFiles: 0,
      usedAt: 1,
    };
    store.save(entry);
    expect(store.current(entry).id).toBe(resource.id);
    const maintenance = new ManagedDependencyMaintenance(store);
    await expect(maintenance.evict({ ...entry, generation: entry.generation + 1 })).rejects.toThrow(
      'eviction_generation_unverified',
    );
    const pinned = db.resources.update(resource.id, resource.revision, {
      consumers: [{ id: 'metadata-reader', kind: 'copy', generation: resource.generation }],
    });
    await expect(maintenance.evict(entry)).rejects.toThrow('active_consumer');
    db.resources.update(pinned.id, pinned.revision, { consumers: [] });
    store.outcome(entry, 'retained', 'cache_held');
    store.outcome(entry, 'retained', 'cache_held');
    expect(db.resources.outcomes(resource.id)).toHaveLength(1);
    expect(() => store.current({ ...entry, key: 'c'.repeat(64) })).toThrow('binding_unverified');
    expect(() => store.current({ ...entry, generation: resource.generation + 1 })).toThrow(
      'generation_changed',
    );
    db.setSetting('resources.managed-dependencies.v1', [{ ...entry, projectId: 'foreign' }]);
    expect(() => store.current(store.artifacts()[0]!)).toThrow('binding_unverified');
  } finally {
    db.close();
  }
});

it('rejects non-task and stale task scopes without materializing a checkout or cache', async () => {
  const db = AppDb.open(':memory:');
  try {
    await expect(
      managedTaskDirectory(db, resolve('.'), { kind: 'project_chat', projectId: 'p', chatId: 'c' }),
    ).rejects.toThrow('task_scope');
    await expect(
      managedTaskDirectory(db, resolve('.'), {
        kind: 'task',
        projectId: 'p',
        taskId: 'T-1',
        runId: 'missing',
      }),
    ).rejects.toThrow('isolated_run');
  } finally {
    db.close();
  }
});

it('checks actual repository ancestry and hashes a bounded existing regular file without writes', async () => {
  const root = resolve('.'),
    file = join(root, 'package.json');
  expect(await canonicalCachePath(root, file)).toBe(file);
  await expect(canonicalCachePath(root, resolve('..', 'outside'))).rejects.toThrow('outside_scope');
  const tree = await cacheTree(root, file);
  expect(tree.files).toHaveLength(1);
  expect(tree.bytes).toBeGreaterThan(0);
  expect(tree.digest).toMatch(/^[a-f0-9]{64}$/);
});

it('discriminates pnpm recovery from legacy npm and validates exact target creation journals', () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Pnpm metadata', path: resolve('.') });
    const store = new ManagedCacheStore(db, resolve('.'));
    const key = 'e'.repeat(64),
      resource = store.resource(project.id, store.path(key), PNPM_DEPENDENCY_RECOVERY, key);
    const entry: ManagedArtifact = {
      manager: 'pnpm',
      key,
      projectId: project.id,
      resourceId: resource.id,
      generation: 1,
      state: 'ready',
      bytes: 1,
      expandedBytes: 1,
      expandedFiles: 1,
      usedAt: 1,
      immutable: true,
      digest: 'f'.repeat(64),
      installTarget: { path: resolve('node_modules'), dev: 1, ino: 2, birthtimeMs: 1.25 },
    };
    store.save(entry);
    expect(store.current(store.artifacts()[0]!).source?.recovery).toBe(PNPM_DEPENDENCY_RECOVERY);
    expect(() => store.current({ ...entry, manager: undefined })).toThrow('binding_unverified');
    expect(() => store.current({ ...entry, manager: 'npm' })).toThrow('binding_unverified');
    for (const changed of [
      { ...entry, manager: 'yarn' },
      { ...entry, manager: undefined },
      { ...entry, installTarget: { ...entry.installTarget, path: '../foreign' } },
      { ...entry, installTarget: { ...entry.installTarget, extra: true } },
    ])
      expect(() => artifactMetadata([changed])).toThrow('metadata');
  } finally {
    db.close();
  }
});

it('keeps native Stats identities separate from safe budget integers and pins the accounting version', async () => {
  const info = await stat(resolve('.'));
  const entry: ManagedArtifact = {
    manager: 'pnpm',
    expansionPolicy: 'pnpm-isolated-unique-nodes-v2',
    key: 'a'.repeat(64),
    projectId: 'metadata',
    resourceId: `resource-${'b'.repeat(64)}`,
    generation: 1,
    state: 'publishing',
    bytes: 0,
    expandedBytes: 0,
    expandedFiles: 0,
    usedAt: 1,
    immutable: false,
    installTarget: {
      path: resolve('.'),
      dev: info.dev,
      ino: info.ino,
      birthtimeMs: info.birthtimeMs,
    },
  };
  expect(artifactMetadata([entry])).toEqual([entry]);
  expect(
    artifactMetadata([
      { ...entry, installTarget: { ...entry.installTarget, ino: Number.MAX_SAFE_INTEGER + 1 } },
    ]),
  ).toHaveLength(1);
  for (const changed of [
    { ...entry, manager: 'npm' },
    { ...entry, expansionPolicy: 'worker-approved' },
    { ...entry, bytes: Number.MAX_SAFE_INTEGER + 1 },
    ...[-1, NaN, Infinity, 0.5].map((ino) => ({
      ...entry,
      installTarget: { ...entry.installTarget, ino },
    })),
  ])
    expect(() => artifactMetadata([changed])).toThrow('metadata');
});

it('retains actual phase capacity for partial disk data even when no child consumer is recorded', () => {
  expect(dependencyPhaseUnsettled('selected', 'operation', [])).toBe(false);
  expect(
    dependencyPhaseUnsettled('selected', 'operation', [{ projectId: 'selected', state: 'ready' }]),
  ).toBe(false);
  expect(
    dependencyPhaseUnsettled('selected', 'operation', [
      { projectId: 'selected', state: 'retained' },
    ]),
  ).toBe(true);
  expect(
    dependencyPhaseUnsettled('selected', 'operation', [{ projectId: 'other', state: 'retained' }]),
  ).toBe(false);
  expect(
    dependencyPhaseUnsettled('selected', 'operation', [
      {
        projectId: 'selected',
        state: 'using',
        consumer: { intent: 'operation', pid: process.pid },
      },
    ]),
  ).toBe(true);
});
