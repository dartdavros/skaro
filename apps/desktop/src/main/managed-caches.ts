import type { AppDb } from '@skaro/core';
import { ManagedCacheStore } from './managed-cache-store';
import { ManagedCacheExecution } from './managed-cache-execution';
import { ManagedDependencyCache } from './managed-dependency-cache';
import { ManagedPnpmCache } from './managed-pnpm-cache';
import { pnpmDependencyProvenance } from './managed-pnpm-provenance';
import { managedDependencyManager } from './managed-dependency-manager';
import { selectManagedCacheContext } from './managed-cache-context';
import { ManagedBuildkitCache } from './managed-buildkit-cache';
import { dependencyProvenance } from './managed-dependency-provenance';
import { inspectManagedBuildSource } from './managed-build-source';
import { cacheBudget, type CacheBudget } from './resource-cache-policy';
import { resourceExecution, resourcesFor } from './resource-execution';
import type { ManagedTaskSource } from './managed-cache-worktree';
import { plannedManagedBuilderImage } from './managed-buildkit-image';
import { observeManagedDockerClient } from './managed-docker-observation';
import { managedBuildNetwork, type ManagedBuildApproval } from './managed-build-profile';

const caches = new WeakMap<AppDb, ManagedCaches>();
export const managedCachesFor = (db: AppDb) => caches.get(db);
const owner = (kind: 'dependencies' | 'buildkit') => `managed-cache:${kind}`;

/** Admission never waits under the global inventory/effects mutex; every admitted phase revalidates. */
export class ManagedCaches {
  readonly store: ManagedCacheStore;
  private readonly dependenciesCache: ManagedDependencyCache;
  private readonly pnpmCache: ManagedPnpmCache;
  private readonly buildkit: ManagedBuildkitCache;
  private readonly execution: ManagedCacheExecution;
  private readonly pending = new Set<Promise<unknown>>();
  private closed = false;
  private readonly shutdown = new AbortController();
  constructor(db: AppDb, dataDir: string) {
    if (caches.has(db)) throw new Error('managed_caches_already_bound');
    this.store = new ManagedCacheStore(db, dataDir);
    this.dependenciesCache = new ManagedDependencyCache(this.store);
    this.pnpmCache = new ManagedPnpmCache(this.store);
    this.buildkit = new ManagedBuildkitCache(this.store);
    this.execution = new ManagedCacheExecution(
      this.store,
      this.buildkit,
      dataDir,
      this.shutdown.signal,
    );
    caches.set(db, this);
  }
  async dependencies(
    projectId: string,
    cwd: string,
    consume = false,
    source?: ManagedTaskSource,
    context = '.',
  ) {
    this.execution.requireExecution(projectId);
    return this.track(async () => {
      const selected = await selectManagedCacheContext(cwd, context);
      return this.execution.withSource(
        projectId,
        cwd,
        source,
        async () => {
          const manager = await managedDependencyManager(selected.cwd);
          const provenance = manager === 'pnpm' ? pnpmDependencyProvenance : dependencyProvenance;
          await provenance(projectId, selected.cwd, 'preflight', selected.context);
          return this.execution.admitted(
            projectId,
            'dependencies',
            cwd,
            (budget) =>
              this.store.serial(async () => {
                this.currentBudget('dependencies', budget);
                await selected.requireCurrent();
                if ((await managedDependencyManager(selected.cwd)) !== manager)
                  throw new Error('managed_dependencies_manager_changed_retry');
                const adapter = manager === 'pnpm' ? this.pnpmCache : this.dependenciesCache;
                return adapter.install(projectId, selected.cwd, consume, selected.context);
              }),
            undefined,
            source,
          );
        },
        selected.requireCurrent,
      );
    });
  }
  async build(
    projectId: string,
    cwd: string,
    taskSource?: ManagedTaskSource,
    context = '.',
    approval?: ManagedBuildApproval,
  ) {
    this.execution.requireExecution(projectId);
    return this.track(async () => {
      const selected = await selectManagedCacheContext(cwd, context);
      return this.execution.withSource(
        projectId,
        cwd,
        taskSource,
        async () => {
          const source = await inspectManagedBuildSource(selected.cwd),
            plan = this.inventory();
          managedBuildNetwork(projectId, selected.cwd, source, approval);
          const client = await observeManagedDockerClient(cwd);
          const image = await plannedManagedBuilderImage(
            cwd,
            this.store.builders().find((x) => x.projectId === projectId)?.image,
            client,
          );
          const incoming = this.store.builders().some((x) => x.projectId === projectId) ? 0 : 1;
          const budget = cacheBudget(this.store.db, 'buildkit');
          if (
            !budget.entries ||
            !budget.bytes ||
            this.store.builders().length + incoming > budget.entries
          )
            throw new Error('managed_buildkit_builder_entries_budget_retained');
          await this.sweepBuilders(incoming, plan);
          return this.execution.admitted(
            projectId,
            'buildkit',
            cwd,
            (budget) =>
              this.store.serial(async () => {
                this.currentBudget('buildkit', budget);
                this.currentInventory(plan);
                const entries = this.store.builders(),
                  share = Math.floor(budget.bytes / Math.max(1, entries.length + incoming));
                if (
                  entries.some(
                    (x) =>
                      x.state !== 'ready' ||
                      x.bytes === undefined ||
                      x.bytes > share ||
                      this.store.db.resources.cleanup.read(x.resourceId),
                  )
                )
                  throw new Error('managed_buildkit_global_inventory_or_budget_retained');
                await selected.requireCurrent();
                return this.buildkit.build(
                  projectId,
                  selected.cwd,
                  source,
                  budget,
                  image,
                  client,
                  approval,
                );
              }),
            source.bytes,
            taskSource,
            source.base === 'scratch' ? 'scratch' : 'trusted-run',
          );
        },
        selected.requireCurrent,
      );
    });
  }
  private inventory() {
    return JSON.stringify(
      this.store
        .builders()
        .map((x) => [x.projectId, x.resourceId, x.generation, x.name, x.token])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
  }
  private currentInventory(plan: string) {
    if (plan !== this.inventory()) throw new Error('managed_cache_inventory_changed_retry');
  }
  private currentBudget(kind: 'dependencies' | 'buildkit', reserved: CacheBudget) {
    if (JSON.stringify(cacheBudget(this.store.db, kind)) !== JSON.stringify(reserved))
      throw new Error('managed_cache_policy_changed_retry');
  }
  private async sweepBuilders(incoming = 0, plan = this.inventory()) {
    const entries = this.store.builders(),
      share = Math.floor(
        cacheBudget(this.store.db, 'buildkit').bytes / Math.max(1, entries.length + incoming),
      );
    for (const entry of entries) {
      if (!this.store.scoped(entry.projectId)) {
        if (
          entry.state !== 'ready' ||
          entry.bytes === undefined ||
          entry.bytes > share ||
          this.store.db.resources.cleanup.read(entry.resourceId)
        )
          throw new Error('managed_buildkit_other_project_budget_retained');
        continue;
      }
      const project = this.store.db.getProject(entry.projectId);
      if (!project) throw new Error('managed_buildkit_project_metadata_unavailable');
      await this.execution.admitted(entry.projectId, 'buildkit', project.path, (budget) =>
        this.store.serial(async () => {
          this.currentBudget('buildkit', budget);
          this.currentInventory(plan);
          await this.buildkit.sweep(entry.projectId, budget, incoming);
        }),
      );
    }
    this.currentInventory(plan);
    if (entries.length > cacheBudget(this.store.db, 'buildkit').entries)
      throw new Error('managed_buildkit_builder_retirement_requires_explicit_reconciliation');
  }
  async sweep(): Promise<void> {
    if (this.closed) return;
    try {
      if (!this.store.artifacts().length && !this.store.builders().length) return;
      await this.track(async () => {
        await this.store.serial(() => this.dependenciesCache.sweep());
        await this.sweepBuilders();
        if (
          this.store.artifacts().some((x) => this.store.scoped(x.projectId) && x.state !== 'ready')
        )
          throw new Error('managed_dependencies_interrupted_or_active_objects_retained');
      });
    } catch (error) {
      const message =
        error instanceof Error && /^managed_[a-z0-9_]+$/.test(error.message)
          ? error.message
          : 'managed_cache_cleanup_fence_or_inventory_retained';
      throw new Error(message, { cause: error });
    }
  }
  private async track<T>(action: () => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('managed_caches_closed');
    const parent = resourceExecution.getStore();
    const signal = parent
      ? AbortSignal.any([parent.signal, this.shutdown.signal])
      : this.shutdown.signal;
    const pending = parent
      ? resourceExecution.run(
          {
            ...parent,
            signal,
            requireCurrent: async () => {
              signal.throwIfAborted();
              await parent.requireCurrent();
              signal.throwIfAborted();
            },
          },
          action,
        )
      : action();
    this.pending.add(pending);
    try {
      return await pending;
    } finally {
      this.pending.delete(pending);
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    this.shutdown.abort(new Error('managed_caches_closed'));
    await Promise.allSettled([...this.pending]);
    if (!this.store.builders().length) return;
    await this.store.serial(async () => {
      for (const entry of this.store.builders().filter((x) => this.store.scoped(x.projectId))) {
        try {
          await this.buildkit.stop(entry.projectId);
          resourcesFor(this.store.db)?.releaseOwner(
            entry.projectId,
            owner('buildkit'),
            'managed_builder_shutdown_stopped_confirmed',
          );
        } catch {
          this.store.outcome(
            entry,
            'retained',
            'managed_buildkit_shutdown_identity_or_consumers_unverified',
          );
        }
      }
    });
  }
}
