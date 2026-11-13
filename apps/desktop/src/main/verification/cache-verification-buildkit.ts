import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { ManagedCacheStore } from '../managed-cache-store';
import type { ManagedBuildkitCache } from '../managed-buildkit-cache';
import type { ManagedCacheExecution } from '../managed-cache-execution';
import { inspectManagedBuildSource } from '../managed-build-source';
import { plannedManagedBuilderImage } from '../managed-buildkit-image';
import { observeManagedDockerClient } from '../managed-docker-observation';
import { inspectOwnedBuilderContainer } from '../managed-buildkit-identity';
import { cacheBudget } from '../resource-cache-policy';
import type { CacheVerificationSource } from './cache-verification-source';
import {
  approveCacheBuildkitSource,
  requireApprovedBuildkitClient,
} from './cache-buildkit-approval';
import { requireCacheBuildkitReceipts } from './cache-buildkit-contract';
import { resumeEmptyBuildkitInitialization } from './cache-buildkit-resume';
import { resumeCreatedBuildkit } from './cache-buildkit-created-resume';
import { stoppedBuildkitReceipt } from './cache-buildkit-stopped-receipt';
import { reactivateStoppedBuildkit, stoppedBuildInput } from './cache-buildkit-stopped-resume';
import type { PreparedManagedBuildInput } from '../managed-build-input';

/** Real exact-source cold/warm solves and explicit eviction on this run's dedicated builder only. */
export async function verifyBuildkitCache(
  store: ManagedCacheStore,
  execution: ManagedCacheExecution,
  cache: ManagedBuildkitCache,
  source: CacheVerificationSource,
  proof: Record<string, unknown>,
  progress: (phase: string) => void,
) {
  const cwd = join(source.root, 'backend'),
    snapshot = await inspectManagedBuildSource(cwd);
  const approval = await approveCacheBuildkitSource(source, snapshot);
  const client = await observeManagedDockerClient(cwd);
  requireApprovedBuildkitClient(client);
  const image = await plannedManagedBuilderImage(cwd, undefined, client);
  proof.imagePlan = image;
  const lifetime = {
    locks: source.locks,
    async requireCurrent() {
      await source.requireCurrent();
    },
    async requireSettled() {
      const entry = store.builders().find((item) => item.projectId === source.projectId);
      assert(entry?.state === 'ready' && !entry.consumer);
      assert(!store.db.resources.cleanup.read(entry.resourceId));
      assert.equal((await inspectOwnedBuilderContainer(store, entry)).observed.running, false);
    },
  };
  const existing = store.builders().find((entry) => entry.projectId === source.projectId);
  const stopped = stoppedBuildkitReceipt(store)?.complete;
  let preparedInput: PreparedManagedBuildInput | undefined;
  if (existing && existing.state !== 'ready') {
    progress(
      stopped
        ? 'buildkit-reactivate-verified-stopped-daemon'
        : 'buildkit-finish-proven-empty-initialization',
    );
    proof.initialization = stopped
      ? await reactivateStoppedBuildkit(store, execution, cwd, snapshot.bytes, lifetime)
      : await (existing.container ? resumeCreatedBuildkit : resumeEmptyBuildkitInitialization)(
          store,
          execution,
          cwd,
          snapshot.bytes,
          image,
          lifetime,
        );
    if (stopped) preparedInput = await stoppedBuildInput(store, cwd, snapshot);
  }
  if (existing?.state === 'ready' && !preparedInput) {
    progress('buildkit-cold-cache-reset');
    await execution.admitted(
      source.projectId,
      'buildkit',
      cwd,
      () =>
        store.serial(async () => {
          await cache.sweep(source.projectId, {
            ...cacheBudget(store.db, 'buildkit'),
            bytes: 0,
            idleMs: 0,
          });
          const current = store.builders().find((item) => item.projectId === source.projectId)!;
          assert.equal(current.bytes, 0);
          proof.coldCacheReset = {
            resourceId: current.resourceId,
            generation: current.generation,
            bytes: current.bytes,
          };
        }),
      snapshot.bytes,
      undefined,
      'trusted-run',
      lifetime,
    );
  }
  let coldDigest: string | undefined;
  for (const warm of [false, true]) {
    progress(warm ? 'buildkit-warm-solve' : 'buildkit-cold-solve');
    const result = await execution.admitted(
      source.projectId,
      'buildkit',
      cwd,
      (budget) =>
        store.serial(() =>
          cache.build(
            source.projectId,
            cwd,
            snapshot,
            budget,
            image,
            client,
            approval,
            warm ? undefined : preparedInput,
          ),
        ),
      snapshot.bytes,
      undefined,
      'trusted-run',
      lifetime,
    );
    const phaseProof: Record<string, unknown> = { result };
    proof[warm ? 'warm' : 'cold'] = phaseProof;
    if (warm) assert.equal(result.snapshotDigest, coldDigest);
    else coldDigest = result.snapshotDigest;
    phaseProof.receipt = requireCacheBuildkitReceipts(result, warm);
  }
  const published = store.builders().find((item) => item.projectId === source.projectId)!;
  assert(published.bytes && published.bytes > 0, 'A real nonempty cache must precede eviction');
  proof.beforeEviction = { ...published };
  progress('buildkit-explicit-owned-cache-eviction');
  await execution.admitted(
    source.projectId,
    'buildkit',
    cwd,
    () =>
      store.serial(async () => {
        await cache.sweep(source.projectId, {
          ...cacheBudget(store.db, 'buildkit'),
          bytes: 0,
          idleMs: 0,
        });
        const current = store.builders().find((item) => item.projectId === source.projectId)!;
        assert.equal(current.resourceId, published.resourceId);
        assert.equal(current.generation, published.generation);
        assert.equal(
          current.bytes,
          0,
          'Explicit owned-builder eviction must be physically confirmed',
        );
        proof.eviction = {
          ...current,
          policy: 'explicit-owned-generation-not-capacity-pressure-or-lru',
        };
      }),
    snapshot.bytes,
    undefined,
    'trusted-run',
    lifetime,
  );
  proof.buildkitOutcomes = store.db.resources.outcomes(published.resourceId);
}
