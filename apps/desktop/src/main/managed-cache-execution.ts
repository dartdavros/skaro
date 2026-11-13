import { cacheBudget, type CacheBudget } from './resource-cache-policy';
import { dependencyPhaseUnsettled, type ManagedCacheLifetime } from './managed-cache-lifetime';
import type { ManagedCacheStore } from './managed-cache-store';
import type { ManagedBuildkitCache } from './managed-buildkit-cache';
import { managedSourceLock, type ManagedTaskSource } from './managed-cache-worktree';
import { resourceExecution, resourcesFor } from './resource-execution';
import { applicationResourcePolicy } from './resource-policy';
import {
  managedCacheCost,
  requireManagedCacheBuildSlot,
  type ManagedCacheBuildProfile,
} from './managed-cache-admission';
import { resourceVolume } from './resource-budget';
import { ResourceAdmissionUnavailable } from './resource-manager';
const owner = (kind: 'dependencies' | 'buildkit') => `managed-cache:${kind}`;

/** Admission and independent source lifetime never hold the global inventory mutex while waiting. */
export class ManagedCacheExecution {
  private readonly store: ManagedCacheStore;
  private readonly buildkit: ManagedBuildkitCache;
  private readonly dataDir: string;
  private readonly shutdown: AbortSignal;
  constructor(
    store: ManagedCacheStore,
    buildkit: ManagedBuildkitCache,
    dataDir: string,
    shutdown: AbortSignal,
  ) {
    this.store = store;
    this.buildkit = buildkit;
    this.dataDir = dataDir;
    this.shutdown = shutdown;
  }
  async withSource<T>(
    projectId: string,
    cwd: string,
    source: ManagedTaskSource | undefined,
    action: () => Promise<T>,
    requireContextCurrent?: () => Promise<void>,
  ) {
    const parent = this.requireExecution(projectId),
      resources = parent.resources!;
    return resources.scope(
      projectId,
      'managed-cache:source',
      async () => {
        const scope = resourceExecution.getStore()!,
          lock = await managedSourceLock(this.store.db, this.dataDir, projectId, cwd, source);
        const held = await resources.acquire('process', scope, {
          wait: false,
          checkpoint: 'managed-cache-source',
          locks: [lock],
          cost: {
            ramBytes: 128 * 1024 ** 2,
            cpuMillis: 500,
            model: 0,
            environment: 0,
            build: 0,
            review: 0,
            diskBytes: {},
          },
        });
        try {
          return await action();
        } finally {
          held.release('source_preflight_and_delegated_cache_phases_settled');
        }
      },
      {
        signal: parent.signal,
        intentId: parent.intentId,
        requireCurrent: async () => {
          await parent.requireCurrent();
          await managedSourceLock(this.store.db, this.dataDir, projectId, cwd, source);
          await requireContextCurrent?.();
        },
      },
    );
  }
  requireExecution(projectId: string) {
    const scope = resourceExecution.getStore();
    if (
      this.shutdown.aborted ||
      !scope?.resources ||
      scope.resources !== resourcesFor(this.store.db) ||
      scope.projectId !== projectId ||
      !this.store.scoped(projectId)
    )
      throw new Error('managed_cache_current_authorized_resource_scope_required');
    return scope;
  }
  async admitted<T>(
    projectId: string,
    kind: 'dependencies' | 'buildkit',
    cwd: string,
    action: (budget: CacheBudget) => Promise<T>,
    sourceBytes?: number,
    source?: ManagedTaskSource,
    profile: ManagedCacheBuildProfile = 'scratch',
    lifetime?: ManagedCacheLifetime,
  ): Promise<T> {
    const parent = resourceExecution.getStore(),
      resources = resourcesFor(this.store.db);
    if (!resources) throw new Error('managed_cache_application_admission_unavailable');
    const envelopes = parent
      ? resources
          .holdings(parent.projectId, parent.ownerId)
          .filter((x) => x.lease.checkpoint === 'worker-command-budget')
      : [];
    requireManagedCacheBuildSlot(
      applicationResourcePolicy(this.store.db).build,
      envelopes.reduce((sum, x) => sum + x.lease.cost.build, 0),
    );
    return resources.scope(
      projectId,
      owner(kind),
      async () => {
        const scope = resourceExecution.getStore()!;
        if (
          kind === 'buildkit' &&
          resources.holdings(projectId, owner(kind)).some((x) => x.lease.state === 'retained')
        )
          throw new Error('managed_buildkit_retained_runtime_requires_explicit_reconciliation');
        const budget = cacheBudget(this.store.db, kind);
        const cost = managedCacheCost(
          kind,
          budget,
          await resourceVolume(this.dataDir),
          await resourceVolume(cwd),
          sourceBytes,
          profile,
        );
        const worktree = source
          ? [await managedSourceLock(this.store.db, this.dataDir, projectId, cwd, source)]
          : [];
        const entry =
          kind === 'buildkit'
            ? this.store.builders().find((x) => x.projectId === projectId)
            : undefined;
        // Acquiring before serial is intentional: cleanup may need that same mutex to release disk pressure.
        const held = await resources
          .acquire('build', scope, {
            cost,
            wait: false,
            checkpoint: `managed-cache-${kind}`,
            locks: [
              ...worktree,
              ...(lifetime?.locks ?? []),
              ...(entry
                ? [
                    {
                      resourceId: entry.resourceId,
                      generation: entry.generation,
                      mode: 'exclusive' as const,
                    },
                  ]
                : []),
            ],
          })
          .catch((error) => {
            if (!(error instanceof ResourceAdmissionUnavailable)) throw error;
            const reason = error.reason
              .replaceAll(':', '_')
              .replace(/([a-z])([A-Z])/g, '$1_$2')
              .toLowerCase();
            throw new Error(`managed_cache_admission_${reason}`, { cause: error });
          });
        const execute = async () => {
          let result: T | undefined, failure: unknown;
          try {
            result = await action(budget);
          } catch (error) {
            failure = error;
          }
          try {
            if (kind === 'buildkit') await this.buildkit.stop(projectId);
            else if (dependencyPhaseUnsettled(projectId, scope.intentId, this.store.artifacts()))
              throw new Error('managed_dependencies_process_or_data_consumer_unverified');
            await lifetime?.requireSettled();
            held.release('managed_cache_process_exit_and_runtime_stop_confirmed');
          } catch (error) {
            const current = this.store.db.admission.get(projectId, held.lease.id);
            if (current?.state === 'granted')
              this.store.db.admission.retain(projectId, current.id, current.revision);
            failure ??= error;
          }
          if (failure) throw failure;
          return result as T;
        };
        return kind === 'buildkit'
          ? resourceExecution.run({ ...scope, cacheAuthority: held }, execute)
          : execute();
      },
      {
        signal: parent ? AbortSignal.any([parent.signal, this.shutdown]) : this.shutdown,
        ...(parent ? { intentId: parent.intentId } : {}),
        requireCurrent: async () => {
          await parent?.requireCurrent();
          await lifetime?.requireCurrent();
        },
      },
    );
  }
}
