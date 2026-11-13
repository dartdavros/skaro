import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { cacheBudget, cacheEviction } from './resource-cache-policy';
import { cacheTree, canonicalCachePath, removeCacheTree } from './managed-cache-files';
import { resourceExecution } from './resource-execution';
import { ManagedCacheStore, dependencyRecovery, type ManagedArtifact } from './managed-cache-store';

/** Durable consumer reconciliation and exact fenced eviction of immutable dependency generations. */
export class ManagedDependencyMaintenance {
  protected readonly store: ManagedCacheStore;
  constructor(store: ManagedCacheStore) {
    this.store = store;
  }
  private active(entry: ManagedArtifact) {
    const scope = resourceExecution.getStore();
    return (
      !!scope &&
      entry.consumer?.pid === process.pid &&
      entry.consumer.intent === scope.intentId &&
      !scope.signal.aborted
    );
  }
  protected scratch(entry: ManagedArtifact) {
    return join(this.store.root, 'scratch', `${entry.key}-${entry.generation}`);
  }

  protected consumer(entry: ManagedArtifact, active: boolean) {
    const resource = this.store.current(entry),
      id = `managed-cache:${entry.key}:${entry.generation}`;
    this.store.db.resources.update(resource.id, resource.revision, {
      consumers: [
        ...resource.consumers.filter((x) => x.id !== id),
        ...(active ? [{ id, kind: 'copy' as const, generation: entry.generation }] : []),
      ],
    });
  }
  protected async removeIfPresent(path: string) {
    await canonicalCachePath(this.store.root, path, true);
    try {
      await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    await removeCacheTree(this.store.root, path);
  }
  protected async discardIncomplete(entry: ManagedArtifact) {
    const resource = this.store.current(entry);
    if (
      entry.immutable ||
      entry.consumer ||
      resource.consumers.length ||
      resource.source?.recovery !== dependencyRecovery(entry)
    )
      throw new Error('managed_dependencies_incomplete_publication_retained');
    await this.store.db.resources.cleanup.run(
      resource,
      `cache.remove:${resource.id}:${entry.generation}`,
      async () => {
        const path = this.store.path(entry.key);
        await canonicalCachePath(this.store.root, path, true);
        try {
          await lstat(path);
          await removeCacheTree(this.store.root, path, undefined, () =>
            this.store.db.resources.cleanup.effect(resource.id),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        this.store.outcome(
          entry,
          'released',
          'managed_dependencies_incomplete_publication_discarded',
        );
        const current = this.store.current(entry);
        this.store.db.resources.update(current.id, current.revision, { state: 'released' });
        this.store.forget(entry.key);
      },
    );
  }

  /** Exact operator/policy eviction; never invent age, pressure, incoming objects or a replacement key. */
  async evict(expected: ManagedArtifact) {
    const { store } = this;
    const entry = store.artifacts().find((item) => item.key === expected.key);
    if (
      !entry ||
      !store.scoped(entry.projectId) ||
      entry.projectId !== expected.projectId ||
      entry.resourceId !== expected.resourceId ||
      entry.generation !== expected.generation ||
      entry.digest !== expected.digest ||
      !entry.immutable ||
      !entry.digest
    )
      throw new Error('managed_dependencies_eviction_generation_unverified');
    const current = store.current(entry);
    if (current.consumers.length || entry.consumer || entry.state !== 'ready')
      throw new Error('managed_dependencies_active_consumer');
    try {
      const tree = await cacheTree(store.root, store.path(entry.key));
      if (tree.digest !== entry.digest) throw new Error('managed_dependencies_integrity_changed');
      return await store.db.resources.cleanup.run(
        current,
        `cache.remove:${current.id}:${entry.generation}`,
        async () => {
          entry.state = 'deleting';
          store.save(entry);
          const bytes = await removeCacheTree(store.root, store.path(entry.key), entry.digest, () =>
            store.db.resources.cleanup.effect(current.id),
          );
          store.outcome(entry, 'released', 'managed_dependencies_evicted', bytes);
          const resource = store.current(entry);
          store.db.resources.update(resource.id, resource.revision, { state: 'released' });
          store.forget(entry.key);
          return {
            key: entry.key,
            resourceId: entry.resourceId,
            generation: entry.generation,
            logicalBytesRemoved: bytes,
          };
        },
      );
    } catch (error) {
      entry.state = 'retained';
      store.save(entry);
      store.outcome(entry, 'retained', 'managed_dependencies_eviction_unverified');
      throw error;
    }
  }

  async sweep(incomingEntries = 0, incomingBytes = 0) {
    const { store } = this;
    for (const entry of store
      .artifacts()
      .filter((x) => store.scoped(x.projectId) && x.state !== 'ready')) {
      // A dead recorded PID alone does not prove all child/file effects settled.
      // Preserve interrupted consumers and scratch until explicit RC-4 reconciliation.
      if (!entry.immutable && !entry.consumer) {
        await this.discardIncomplete(entry).catch(() =>
          store.outcome(entry, 'retained', 'managed_dependencies_partial_publication_retained'),
        );
      } else if (entry.state !== 'ready' && !this.active(entry))
        store.outcome(
          entry,
          'retained',
          'managed_dependencies_interrupted_operation_requires_reconciliation',
        );
    }
    const candidates = store.artifacts().map((entry) => {
      const resource = store.current(entry);
      return {
        id: entry.key,
        bytes: entry.bytes,
        usedAt: entry.usedAt,
        consumers: resource.consumers.length + (entry.state !== 'ready' ? 1 : 0),
        ownership:
          resource.ownership === 'registered' ? ('registered' as const) : ('unknown' as const),
        preservation:
          resource.preservation === 'reproducible'
            ? ('reproducible' as const)
            : ('unknown' as const),
        immutable: !!entry.immutable,
        secretsExcluded: resource.source?.recovery === dependencyRecovery(entry),
        privateScope:
          store.scoped(entry.projectId) && resource.identity.path === store.path(entry.key),
      };
    });
    const result = cacheEviction(
      candidates,
      cacheBudget(store.db, 'dependencies'),
      Date.now(),
      incomingBytes,
      incomingEntries,
    );
    for (const key of result.remove) {
      const entry = store.artifacts().find((x) => x.key === key)!;
      try {
        await this.evict(entry);
      } catch {
        store.outcome(entry, 'retained', 'managed_dependencies_eviction_unverified');
      }
    }
    for (const retained of result.retained) {
      const entry = store.artifacts().find((x) => x.key === retained.id)!;
      if (store.scoped(entry.projectId) && !this.active(entry))
        store.outcome(
          entry,
          'retained',
          `managed_dependencies_${retained.reason.replaceAll('-', '_')}`,
        );
    }
    // Recompute after executor results: a policy plan is not evidence that deletion actually happened.
    const remaining = store.artifacts();
    const budget = cacheBudget(store.db, 'dependencies');
    if (
      (incomingEntries || incomingBytes) &&
      (remaining.length + incomingEntries > budget.entries ||
        remaining.reduce((sum, x) => sum + x.bytes, incomingBytes) > budget.bytes)
    )
      throw new Error('managed_dependencies_budget_retained');
  }
}
