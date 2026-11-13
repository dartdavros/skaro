import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cacheBudget, type CacheBudget } from './resource-cache-policy';
import { ManagedCacheStore, type ManagedBuilder } from './managed-cache-store';
import {
  allocateBuilder,
  bootstrapBuilder,
  builderDirectory,
  builderExternal,
  buildkitGcConfiguration,
  inspectBuilder,
  startBuilder,
} from './managed-buildkit-identity';
import { ManagedBuildkitRuntime } from './managed-buildkit-runtime';
import { solveManagedBuild } from './managed-build-solve';
import { managedBuildNetwork, type ManagedBuildApproval } from './managed-build-profile';
import { cacheTree, canonicalCachePath, removeCacheTree } from './managed-cache-files';
import { exportManagedBuildSource, type ManagedBuildSource } from './managed-build-source';
import type { ManagedBuilderImage } from './managed-buildkit-image';
import type { ManagedDockerClient } from './managed-docker-client';
import { resourceExecution } from './resource-execution';
import { consumeManagedBuildInput, type PreparedManagedBuildInput } from './managed-build-input';
export { buildkitUsage } from './managed-buildkit-runtime';

/** Only explicit typed cached solves use this route; owner/default Docker commands are never rewritten. */
export class ManagedBuildkitCache {
  private readonly store: ManagedCacheStore;
  private readonly runtime: ManagedBuildkitRuntime;
  constructor(store: ManagedCacheStore) {
    this.store = store;
    this.runtime = new ManagedBuildkitRuntime(store);
  }
  private policy(reserved: CacheBudget): CacheBudget {
    const current = cacheBudget(this.store.db, 'buildkit');
    return {
      ...reserved,
      entries: Math.min(reserved.entries, current.entries),
      bytes: Math.min(reserved.bytes, current.bytes),
      idleMs: Math.min(reserved.idleMs, current.idleMs),
    };
  }
  async build(
    projectId: string,
    cwd: string,
    source: ManagedBuildSource,
    reserved: CacheBudget,
    image: ManagedBuilderImage,
    client: ManagedDockerClient,
    approval?: ManagedBuildApproval,
    preparedInput?: PreparedManagedBuildInput,
  ) {
    const { store } = this,
      scope = resourceExecution.getStore();
    if (!scope?.resources || scope.projectId !== projectId)
      throw new Error('managed_cache_resource_admission_required');
    managedBuildNetwork(projectId, cwd, source, approval);
    const count =
      store.builders().length + (store.builders().some((x) => x.projectId === projectId) ? 0 : 1);
    const budget = this.policy(reserved),
      share = Math.floor(budget.bytes / count);
    const entry = await allocateBuilder(store, projectId, share, budget.entries, image, client);
    const context = join(builderDirectory(store, projectId), 'context');
    const prepared = preparedInput
      ? await consumeManagedBuildInput(preparedInput, store, entry, cwd, source)
      : undefined;
    let contextOwned = false,
      contextDigest: string | undefined;
    return this.runtime.maintain(
      entry,
      async () => {
        await bootstrapBuilder(store, entry, image);
        await startBuilder(store, entry);
        await this.applyPolicy(entry, share, budget);
        if ((await this.runtime.usage(entry)).inUse)
          throw new Error('managed_buildkit_active_consumer');
        entry.state = 'using';
        store.saveBuilder(entry);
        let digest: string;
        if (prepared) {
          contextOwned = true;
          digest = prepared.snapshotDigest;
          contextDigest = prepared.contextDigest;
        } else {
          digest = await exportManagedBuildSource(cwd, store.root, context, source, () => {
            contextOwned = true;
          });
          contextDigest = (await cacheTree(store.root, context)).digest;
        }
        const proof = await solveManagedBuild(
          store,
          entry,
          context,
          cwd,
          source,
          contextDigest,
          approval,
        );
        entry.usedAt = Date.now();
        store.saveBuilder(entry);
        await this.gc(entry, share, budget);
        store.outcome(entry, 'observed', 'managed_buildkit_static_cached_solve_completed');
        return {
          state: 'verified-cached-solve',
          builder: entry.name,
          sourceDigest: digest,
          ...proof,
          snapshotDigest: digest,
        };
      },
      async () => {
        if (!contextOwned) return;
        if (!contextDigest)
          throw new Error('managed_buildkit_partial_context_requires_explicit_reconciliation');
        await removeCacheTree(
          store.root,
          context,
          contextDigest,
          () => store.db.resources.cleanup.effect(entry.resourceId),
          prepared?.observation,
        );
      },
    );
  }
  private async applyPolicy(entry: ManagedBuilder, bytes: number, budget: CacheBudget) {
    const policy = buildkitGcConfiguration({ ...budget, bytes });
    if (policy === entry.policy) return;
    if ((await this.runtime.usage(entry)).inUse)
      throw new Error('managed_buildkit_policy_update_active_consumer');
    const config = join(builderDirectory(this.store, entry.projectId), 'buildkitd.toml');
    await canonicalCachePath(this.store.root, config);
    this.store.db.resources.cleanup.effect(entry.resourceId);
    await writeFile(config, policy, { mode: 0o600 });
    await inspectBuilder(this.store, entry);
    await builderExternal(this.store, entry, [
      'container',
      'cp',
      config,
      `${entry.container}:/buildkitd.toml`,
    ]);
    await inspectBuilder(this.store, entry);
    await builderExternal(this.store, entry, ['container', 'restart', entry.container!]);
    await inspectBuilder(this.store, entry);
    entry.policy = policy;
    this.store.saveBuilder(entry);
  }
  private async gc(entry: ManagedBuilder, share: number, budget: CacheBudget) {
    const before = await this.runtime.usage(entry);
    if (before.inUse) throw new Error('managed_buildkit_active_consumer');
    await inspectBuilder(this.store, entry);
    await builderExternal(this.store, entry, [
      'buildx',
      'prune',
      '--builder',
      entry.name,
      '--force',
      '--all',
      '--filter',
      `until=${Math.floor(budget.idleMs / 1000)}s`,
    ]);
    await inspectBuilder(this.store, entry);
    await builderExternal(this.store, entry, [
      'buildx',
      'prune',
      '--builder',
      entry.name,
      '--force',
      '--all',
      ...(share > 0
        ? ['--reserved-space=0', `--max-used-space=${share}`, '--min-free-space=0']
        : []),
    ]);
    const after = await this.runtime.usage(entry);
    entry.bytes = after.bytes;
    this.store.saveBuilder(entry);
    if (after.bytes > share) throw new Error('managed_buildkit_budget_active_or_unreclaimable');
    this.store.outcome(entry, 'observed', 'managed_buildkit_gc_confirmed');
    if (before.bytes > 0 && after.bytes === 0)
      this.store.db.addEvent(entry.projectId, 'cache_evicted', {
        resource: entry.resourceId,
        generation: entry.generation,
        beforeBytes: before.bytes,
        afterBytes: after.bytes,
      });
  }
  async sweep(projectId: string, reserved: CacheBudget, incomingBuilders = 0) {
    const { store } = this,
      entries = store.builders(),
      budget = this.policy(reserved);
    const share = Math.floor(budget.bytes / Math.max(1, entries.length + incomingBuilders));
    const entry = entries.find((x) => x.projectId === projectId);
    if (!entry || !store.scoped(entry.projectId)) return;
    if (entry.state !== 'ready')
      throw new Error('managed_buildkit_interrupted_operation_requires_explicit_reconciliation');
    await this.runtime.maintain(entry, async () => {
      await startBuilder(store, entry);
      if (share > 0) await this.applyPolicy(entry, share, budget);
      await this.gc(entry, share, budget);
    });
  }
  stop(projectId: string) {
    return this.runtime.stop(projectId);
  }
}
