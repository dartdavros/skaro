import assert from 'node:assert/strict';
import { join, relative } from 'node:path';
import type { ManagedCacheStore } from '../managed-cache-store';
import type { ManagedCacheExecution } from '../managed-cache-execution';
import type { ManagedCacheLifetime } from '../managed-cache-lifetime';
import type { ManagedBuildSource } from '../managed-build-source';
import { cacheTree } from '../managed-cache-files';
import { encodeNativeIdentity } from '../managed-native-identity';
import { prepareManagedBuildInput } from '../managed-build-input';
import { ManagedBuildkitRuntime } from '../managed-buildkit-runtime';
import { startBuilder } from '../managed-buildkit-identity';
import { cacheBudget } from '../resource-cache-policy';
import { inspectStoppedBuildkit } from './cache-buildkit-stopped-journal';
import { stoppedBuildkitReceipt } from './cache-buildkit-stopped-receipt';

export function stoppedBuilderTarget(store: ManagedCacheStore) {
  const j = stoppedBuildkitReceipt(store);
  assert(j?.complete);
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

export async function reactivateStoppedBuildkit(
  store: ManagedCacheStore,
  execution: ManagedCacheExecution,
  cwd: string,
  sourceBytes: number,
  lifetime: ManagedCacheLifetime,
) {
  const { entry, journal } = stoppedBuilderTarget(store);
  assert.deepEqual(await inspectStoppedBuildkit(store), journal.observed);
  const runtime = new ManagedBuildkitRuntime(store);
  let observedBytes: number | undefined;
  await execution.admitted(
    entry.projectId,
    'buildkit',
    cwd,
    () =>
      store.serial(async () => {
        assert.deepEqual(await inspectStoppedBuildkit(store), journal.observed);
        await runtime.maintain(entry, async () => {
          await startBuilder(store, entry);
          const usage = await runtime.usage(entry);
          assert(!usage.inUse && usage.bytes <= cacheBudget(store.db, 'buildkit').bytes);
          observedBytes = usage.bytes;
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
    observedBytes,
    policy: 'closed-rpc-and-stopped-daemon-reactivated-with-new-exclusive-live-admission',
  };
}

/** Only the exact producer's retained context subset is reusable after Buildx legitimately updates its own files. */
export async function stoppedBuildInput(
  store: ManagedCacheStore,
  cwd: string,
  source: ManagedBuildSource,
) {
  const j = stoppedBuildkitReceipt(store);
  assert(j?.complete);
  const entry = store.builders().find((item) => item.projectId === j.observed.entry.projectId)!;
  assert.equal(entry.state, 'ready');
  assert.equal(entry.resourceId, j.resource.id);
  assert.equal(entry.generation, j.resource.generation);
  const normalize = (value: string) => value.replaceAll('\\', '/');
  const expected = j.observed.layout
    .filter(
      (node) => normalize(node.path) === 'context' || normalize(node.path).startsWith('context/'),
    )
    .map((node) => ({
      ...node,
      path: normalize(node.path) === 'context' ? '' : normalize(node.path).slice(8),
    }));
  const verify = async () => {
    const current = store.current(entry);
    assert.equal(current.generation, j.resource.generation);
    assert.equal(store.db.resources.cleanup.read(current.id)?.externalPending ?? false, false);
    assert(
      j.originals.every(
        (lease) => store.db.admission.get(lease.projectId, lease.id)?.state === 'released',
      ),
    );
    const root = join(store.builderPath(entry.projectId), 'context');
    const tree = await cacheTree(store.root, root, source.bytes);
    const observed = [...tree.nodes].map(([path, node]) => ({
      path: normalize(relative(root, path)),
      identity: encodeNativeIdentity(node.native),
      mode: node.native.mode.toString(),
      bytes: node.native.size.toString(),
      mtime: node.native.mtimeNs.toString(),
      ...(node.children ? { children: node.children } : {}),
    }));
    assert.deepEqual(observed, expected);
  };
  return prepareManagedBuildInput(store, entry, cwd, source, verify);
}
