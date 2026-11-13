import assert from 'node:assert/strict';
import type { ManagedCacheStore } from '../managed-cache-store';
import type { ManagedCacheExecution } from '../managed-cache-execution';
import type { ManagedBuilderImage } from '../managed-buildkit-image';
import type { ManagedCacheLifetime } from '../managed-cache-lifetime';
import { ManagedBuildkitRuntime } from '../managed-buildkit-runtime';
import { bootstrapBuilder } from '../managed-buildkit-provision';
import { resourceExecution } from '../resource-execution';
import {
  INITIALIZATION_KEY,
  initializationEntry,
  emptyInitializationLayout,
  type InitializationJournal,
} from './cache-buildkit-initialization';

/** Finish the proven empty allocation under NEW exclusive admission; never mark it ready in metadata. */
export async function resumeEmptyBuildkitInitialization(
  store: ManagedCacheStore,
  execution: ManagedCacheExecution,
  cwd: string,
  sourceBytes: number,
  image: ManagedBuilderImage,
  lifetime: ManagedCacheLifetime,
) {
  const j = store.db.getSetting<InitializationJournal | undefined>(INITIALIZATION_KEY, undefined);
  assert(j?.complete, 'Existing builder requires a completed exact initialization reconciliation');
  assert(
    j.originals.every(
      (lease) => store.db.admission.get(lease.projectId, lease.id)?.state === 'released',
    ),
  );
  assert(
    j.controls.every((id) =>
      ['released', 'cancelled'].includes(
        store.db.admission.get(j.entry.projectId, id)?.state ?? '',
      ),
    ),
  );
  const entry = initializationEntry(store);
  assert.deepEqual(entry, j.entry);
  assert.deepEqual(await emptyInitializationLayout(store), j.layout);
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
        const authority = resourceExecution.getStore()?.cacheAuthority;
        assert(authority);
        assert.deepEqual(initializationEntry(store, authority.lease), j.entry);
        assert.deepEqual(await emptyInitializationLayout(store), j.layout);
        await runtime.maintain(entry, async () => {
          await bootstrapBuilder(store, entry, image);
          const usage = await runtime.usage(entry);
          assert.deepEqual(usage, { bytes: 0, inUse: false });
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
    initialBytes: 0,
    policy: 'exact-empty-allocation-finished-with-new-exclusive-live-admission',
  };
}
