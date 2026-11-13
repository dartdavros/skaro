import assert from 'node:assert/strict';
import { lstat } from 'node:fs/promises';
import type { ManagedCacheStore } from '../managed-cache-store';
import type { ManagedCacheExecution } from '../managed-cache-execution';
import type { ManagedPnpmCache } from '../managed-pnpm-cache';
import type { ManagedCacheLifetime } from '../managed-cache-lifetime';
import { cacheTree } from '../managed-cache-files';
import { cacheVerificationInput } from './cache-verification-input';
import {
  requireCacheVerificationSource,
  type CacheVerificationSource,
} from './cache-verification-source';
import { CACHE_VERIFICATION_OWNER_SCOPE } from './cache-verification-scope';

/** Real publication, two ORIGINAL-lock offline consumers, then explicit new-generation eviction (not LRU pressure). */
export async function verifyDependencyCache(
  store: ManagedCacheStore,
  execution: ManagedCacheExecution,
  cache: ManagedPnpmCache,
  source: CacheVerificationSource,
  data: string,
  proof: Record<string, unknown>,
) {
  requireCacheVerificationSource(source);
  assert.equal(
    store.artifacts().filter((entry) => entry.projectId === source.projectId).length,
    0,
    'Do not adopt, modify or evict a pre-existing project cache for verification',
  );
  const operations: unknown[] = [];
  proof.dependencyOperations = operations;
  async function install(consume: boolean) {
    const input = await cacheVerificationInput(store, source);
    const result = await execution.admitted(
      source.projectId,
      'dependencies',
      data,
      () =>
        store.serial(() =>
          input.run((cwd) =>
            cache.install(
              source.projectId,
              cwd,
              consume,
              CACHE_VERIFICATION_OWNER_SCOPE.dependencies,
            ),
          ),
        ),
      undefined,
      undefined,
      'scratch',
      input.lifetime,
    );
    operations.push({
      ...result,
      inputResourceId: input.resourceId,
      inputGeneration: input.generation,
      originalInputDigest: input.inputDigest,
    });
    assert.equal(store.db.resources.get(input.resourceId)?.state, 'released');
    assert.equal(store.db.resources.cleanup.read(input.resourceId), undefined);
    return result;
  }
  const published = await install(false);
  assert.equal(published.state, 'published');
  const entry = store.artifacts().find((candidate) => candidate.key === published.key)!;
  assert(entry?.immutable && entry.manager === 'pnpm' && entry.digest);
  const originalDigest = entry.digest;
  proof.dependencyPublication = { ...entry };
  for (let index = 0; index < 2; index++) {
    const installed = await install(true);
    assert.equal(installed.state, 'installed');
    assert.equal(installed.key, entry.key);
    const current = store.artifacts().find((candidate) => candidate.key === entry.key)!;
    assert.equal(current.generation, entry.generation);
    assert.equal(current.digest, originalDigest);
    assert.equal((await cacheTree(store.root, store.path(entry.key))).digest, originalDigest);
    assert.equal(current.consumer, undefined);
    assert.equal(store.current(current).consumers.length, 0);
  }
  let removed = false;
  const lifetime: ManagedCacheLifetime = {
    locks: source.locks,
    async requireCurrent() {
      requireCacheVerificationSource(source);
      await source.requireCurrent();
    },
    async requireSettled() {
      if (!removed) throw new Error('cache_verification_eviction_unsettled');
    },
  };
  proof.dependencyEviction = await execution.admitted(
    source.projectId,
    'dependencies',
    data,
    () =>
      store.serial(async () => {
        const result = await cache.evict(entry);
        assert.equal(
          store.artifacts().some((candidate) => candidate.key === entry.key),
          false,
        );
        assert.equal(store.db.resources.get(entry.resourceId)?.state, 'released');
        assert.equal(store.db.resources.cleanup.read(entry.resourceId), undefined);
        await assert.rejects(lstat(store.path(entry.key)), { code: 'ENOENT' });
        removed = true;
        return { ...result, policy: 'explicit-owned-generation-not-capacity-pressure-or-lru' };
      }),
    undefined,
    undefined,
    'scratch',
    lifetime,
  );
  proof.dependencyOutcomes = store.db.resources.outcomes(entry.resourceId);
}
