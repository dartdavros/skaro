import assert from 'node:assert/strict';
import type { ManagedCacheStore } from '../managed-cache-store';
import type { ManagedCacheExecution } from '../managed-cache-execution';
import type { ManagedCacheLifetime } from '../managed-cache-lifetime';
import type { ManagedBuilderImage } from '../managed-buildkit-image';
import { ManagedBuildkitRuntime } from '../managed-buildkit-runtime';
import { registerCreatedBuilder } from '../managed-buildkit-provision';
import {
  CREATED_KEY,
  CREATED_CONTAINER,
  inspectCreatedBuildkit,
} from './cache-buildkit-created-inspection';
import type { CreatedJournal } from './cache-buildkit-created-journal';

export function createdBuilderTarget(store: ManagedCacheStore) {
  const j = store.db.getSetting<CreatedJournal | undefined>(CREATED_KEY, undefined);
  assert(j?.complete);
  assert.equal(j.observed.entry.container, CREATED_CONTAINER);
  const entry = store.builders().find((item) => item.projectId === j.observed.entry.projectId)!;
  assert.deepEqual(entry, j.observed.entry);
  assert(
    j.originals.every(
      (lease) => store.db.admission.get(lease.projectId, lease.id)?.state === 'released',
    ),
  );
  assert(
    j.controls.every((id) =>
      ['released', 'cancelled'].includes(store.db.admission.get(entry.projectId, id)?.state ?? ''),
    ),
  );
  assert.equal(store.db.resources.cleanup.read(entry.resourceId), undefined);
  return { entry, journal: j };
}

export async function resumeCreatedBuildkit(
  store: ManagedCacheStore,
  execution: ManagedCacheExecution,
  cwd: string,
  sourceBytes: number,
  image: ManagedBuilderImage,
  lifetime: ManagedCacheLifetime,
) {
  const { entry, journal } = createdBuilderTarget(store);
  assert.deepEqual(await inspectCreatedBuildkit(store), journal.observed);
  assert.equal(image.id, entry.image);
  assert.equal(image.source, entry.imageSource);
  assert.equal(image.bytes, entry.imageBytes);
  const runtime = new ManagedBuildkitRuntime(store);
  await execution.admitted(
    entry.projectId,
    'buildkit',
    cwd,
    () =>
      store.serial(async () => {
        assert.deepEqual(await inspectCreatedBuildkit(store), journal.observed);
        await runtime.maintain(entry, async () => {
          await registerCreatedBuilder(store, entry);
          assert.deepEqual(await runtime.usage(entry), { bytes: 0, inUse: false });
        });
      }),
    sourceBytes,
    undefined,
    'trusted-run',
    lifetime,
  );
  return {
    resourceId: entry.resourceId,
    generation: entry.generation,
    container: entry.container,
    initialBytes: 0,
    policy: 'never-started-empty-volume-finished-with-new-exclusive-live-admission',
  };
}
