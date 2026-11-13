import { createHash, randomUUID } from 'node:crypto';
import { lstat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Stats } from 'node:fs';
import type { ManagedCacheStore } from '../managed-cache-store';
import type { ManagedCacheLifetime } from '../managed-cache-lifetime';
import type { ManagedPnpmCache } from '../managed-pnpm-cache';
import { readManagedPnpmInput } from '../managed-pnpm-provenance';
import { exclusivePnpmDirectory } from '../managed-pnpm-operation';
import { removePnpmNodeModules } from '../managed-pnpm-layout';
import { cacheTree, canonicalCachePath, removeCacheTree } from '../managed-cache-files';
import { selectManagedCacheContext } from '../managed-cache-context';
import { resourceExecution } from '../resource-execution';
import { CACHE_VERIFICATION_OWNER_SCOPE } from './cache-verification-scope';
import {
  requireCacheVerificationSource,
  type CacheVerificationSource,
} from './cache-verification-source';

type Result = Awaited<ReturnType<ManagedPnpmCache['install']>>;
const RECOVERY = 'skaro:verified-original-pnpm-input-v1';
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Exact real input transport, never a synthetic package/task or writable main checkout. */
export async function cacheVerificationInput(
  store: ManagedCacheStore,
  source: CacheVerificationSource,
) {
  requireCacheVerificationSource(source);
  const selected = await selectManagedCacheContext(
    source.root,
    CACHE_VERIFICATION_OWNER_SCOPE.dependencies,
  );
  const original = await readManagedPnpmInput(selected.cwd);
  const inputDigest = createHash('sha256')
    .update(JSON.stringify([digest(original.packageBytes), digest(original.lockBytes)]))
    .digest('hex');
  const path = join(store.root, 'verification-inputs', randomUUID());
  const record = store.resource(source.projectId, path, RECOVERY, inputDigest);
  let started = false,
    settled = false,
    identity: Stats | undefined;
  async function requireCurrent() {
    requireCacheVerificationSource(source);
    await source.requireCurrent();
    await selected.requireCurrent();
    const input = await readManagedPnpmInput(selected.cwd);
    if (
      !input.packageBytes.equals(original.packageBytes) ||
      !input.lockBytes.equals(original.lockBytes)
    )
      throw new Error('cache_verification_original_input_changed');
    const current = store.db.resources.get(record.id);
    if (
      !current ||
      current.projectId !== source.projectId ||
      current.generation !== record.generation ||
      current.kind !== 'cache' ||
      current.purpose !== 'cache' ||
      current.ownership !== 'registered' ||
      current.preservation !== 'reproducible' ||
      current.identity.path !== path ||
      current.owner.kind !== 'project' ||
      current.owner.id !== source.projectId ||
      current.source?.recovery !== RECOVERY ||
      current.source.dataVersion !== inputDigest ||
      current.state !== (settled ? 'released' : 'available')
    )
      throw new Error('cache_verification_input_resource_changed');
    if (identity && !settled) {
      await canonicalCachePath(store.root, path);
      const actual = await lstat(path);
      if (
        !actual.isDirectory() ||
        actual.dev !== identity.dev ||
        actual.ino !== identity.ino ||
        actual.birthtimeMs !== identity.birthtimeMs
      )
        throw new Error('cache_verification_input_identity_changed');
    }
  }
  const lifetime: ManagedCacheLifetime = {
    locks: [
      ...source.locks,
      { resourceId: record.id, generation: record.generation, mode: 'exclusive' },
    ],
    requireCurrent,
    async requireSettled() {
      if (started && (!settled || store.db.resources.cleanup.read(record.id)))
        throw new Error('cache_verification_input_or_executor_unsettled');
    },
  };
  return {
    lifetime,
    resourceId: record.id,
    generation: record.generation,
    inputDigest,
    async run(action: (cwd: string) => Promise<Result>): Promise<Result> {
      if (started) throw new Error('cache_verification_input_single_use_required');
      started = true;
      await requireCurrent();
      const scope = resourceExecution.getStore();
      const held = scope?.resources
        ?.holdings(source.projectId, 'managed-cache:dependencies')
        .find(
          (holding) =>
            holding.lease.state === 'granted' &&
            holding.lease.intentId === scope.intentId &&
            holding.lease.checkpoint === 'managed-cache-dependencies' &&
            holding.lease.locks.some(
              (lock) =>
                lock.resourceId === record.id &&
                lock.generation === record.generation &&
                lock.mode === 'exclusive',
            ),
        );
      if (
        !scope ||
        scope.projectId !== source.projectId ||
        scope.ownerId !== 'managed-cache:dependencies' ||
        !held ||
        !lifetime.locks.every((required) =>
          held.lease.locks.some(
            (lock) =>
              lock.resourceId === required.resourceId &&
              lock.generation === required.generation &&
              lock.mode === required.mode,
          ),
        )
      )
        throw new Error('cache_verification_fresh_admitted_input_lease_required');
      const current = store.db.resources.get(record.id)!;
      const result = await store.db.resources.cleanup.runLeased(
        current,
        `cache.input:${record.id}:${record.generation}`,
        held.lease,
        async () => {
          store.db.resources.cleanup.effect(record.id);
          await exclusivePnpmDirectory(store.root, path);
          identity = await lstat(path);
          for (const [name, bytes] of [
            ['package.json', original.packageBytes],
            ['pnpm-lock.yaml', original.lockBytes],
          ] as const) {
            await canonicalCachePath(store.root, join(path, name), true);
            await writeFile(join(path, name), bytes, { flag: 'wx', mode: 0o600 });
          }
          const before = await cacheTree(store.root, path);
          await requireCurrent();
          store.db.resources.cleanup.effect(record.id, true);
          const installed = await action(path);
          // The admitted adapter returned only after all supervised children closed and original-lock checks passed.
          store.db.resources.cleanup.externalSettled(record.id);
          await requireCurrent();
          if ('installedTarget' in installed && installed.installedTarget) {
            await removePnpmNodeModules(
              path,
              installed.installedTarget.path,
              installed.installedTarget,
            );
          }
          if ((await cacheTree(store.root, path)).digest !== before.digest)
            throw new Error('cache_verification_operational_input_changed');
          await removeCacheTree(store.root, path, before.digest, () =>
            store.db.resources.cleanup.effect(record.id),
          );
          const released = store.db.resources.get(record.id)!;
          store.db.resources.update(released.id, released.revision, {
            state: 'released',
            consumers: [],
          });
          return installed;
        },
      );
      settled = true;
      return result;
    },
  };
}
