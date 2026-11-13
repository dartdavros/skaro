import { CleanupFenceStore, cleanupFenceKey as key } from './resource-cleanup-store.ts';
import {
  cleanupOwner as owner,
  activeCleanupTokens as active,
  settledCleanupTokens as settled,
  cleanupSignature,
  ownsCleanupLease,
  stopEnvironmentResource,
} from './resource-cleanup-owner.ts';
import { type ResourceLease } from '../resources/admission-model.ts';
import type { DatabaseSync } from 'node:sqlite';
import { claimCleanup } from './resource-cleanup-claim.ts';
import {
  prepareCacheReconciliation,
  type CacheReconciliationAuthority,
} from './resource-cache-reconciliation.ts';
import type { ResourceRecord, ResourceRegistration } from '../resources/model.ts';
import { resourceCleanupContext, type ResourceCleanupFence } from '../resources/cleanup-context.ts';

/** Durable exclusion, not a capacity estimate/TTL. Admission and consumer mutations share its SQLite gate. */
export class DbResourceCleanup {
  private readonly db: DatabaseSync;
  private readonly store: CleanupFenceStore;
  private readonly resource: (id: string) => ResourceRecord | undefined;
  constructor(db: DatabaseSync, resource: (id: string) => ResourceRecord | undefined) {
    this.db = db;
    this.store = new CleanupFenceStore(db);
    this.resource = resource;
  }

  read(id: string): ResourceCleanupFence | undefined {
    return this.store.read(id);
  }
  atomic<T>(action: () => T): T {
    return this.store.atomic(action);
  }
  blocking(
    resource: Pick<ResourceRegistration, 'identity' | 'objectIds'>,
  ): ResourceCleanupFence | undefined {
    return this.store.blocking(resource.identity, resource.objectIds);
  }
  assertRegistration(id: string, resource: ResourceRegistration): void {
    const fence = this.blocking(resource);
    const context = resourceCleanupContext.getStore()?.fence;
    if (fence && (fence.resourceId !== id || context?.token !== fence.token))
      throw new Error('Resource cleanup excludes overlapping registrations');
  }

  assertMutation(previous: ResourceRecord, next: ResourceRegistration): void {
    const fence = this.blocking(previous) ?? this.blocking(next);
    if (!fence) return;
    const execution = resourceCleanupContext.getStore();
    execution?.assertCurrent?.();
    if (execution?.readOnly)
      throw new Error('Unstarted BuildKit reconciliation cannot mutate resources');
    const current = execution?.fence;
    if (
      execution?.localOnly &&
      (next.generation !== previous.generation ||
        cleanupSignature(next) !== cleanupSignature(previous) ||
        JSON.stringify(next.objectIds ?? []) !== JSON.stringify(previous.objectIds ?? []) ||
        (previous.state === 'released' && next.state !== 'released'))
    )
      throw new Error('Cache reconciliation cannot renew or reclassify a generation');
    if (
      !current ||
      fence.resourceId !== previous.id ||
      current.token !== fence.token ||
      current.owner !== fence.owner ||
      fence.generation !== current.generation
    )
      throw new Error('Resource cleanup excludes new consumers and mutations');
    if (
      next.consumers.some((consumer) => !previous.consumers.some((old) => old.id === consumer.id))
    )
      throw new Error('Resource cleanup cannot admit new consumers');
    if (
      fence.mode === 'stop' &&
      (next.generation !== previous.generation || next.state === 'released')
    )
      throw new Error('Environment stop cannot remove or renew a resource');
    if (next.generation !== previous.generation && fence.state !== 'verified')
      throw new Error('Resource generation cannot advance before cleanup verification');
  }

  ownsLeaseConsumer(consumerId: string): boolean {
    const context = resourceCleanupContext.getStore()?.fence;
    return !!context && ownsCleanupLease(consumerId, context, this.read(context.resourceId));
  }

  private require(fence: ResourceCleanupFence): ResourceCleanupFence {
    const saved = this.read(fence.resourceId);
    const context = resourceCleanupContext.getStore()?.fence;
    if (
      !saved ||
      saved.token !== fence.token ||
      saved.owner !== owner ||
      !context ||
      context.token !== fence.token ||
      !active.has(fence.token)
    )
      throw new Error('Resource cleanup fencing token or owner changed');
    return saved;
  }

  effect(resourceId: string, external = false, effect: 'remove' | 'stop' = 'remove'): void {
    const context = resourceCleanupContext.getStore();
    if (!context || context.fence.resourceId !== resourceId)
      throw new Error('Destructive cleanup requires its exclusive execution context');
    context.assertCurrent?.();
    if (context.readOnly)
      throw new Error('Unstarted BuildKit reconciliation cannot dispatch effects');
    if (context.localOnly && external)
      throw new Error('Cache reconciliation cannot dispatch an external executor');
    this.atomic(() => {
      const fence = this.require(context.fence);
      if (fence.mode === 'stop' && effect !== 'stop')
        throw new Error('Environment stop cannot execute resource removal');
      this.store.save({
        ...fence,
        state: 'running',
        externalPending: external || fence.externalPending,
      });
    });
  }

  externalSettled(resourceId: string): void {
    const context = resourceCleanupContext.getStore();
    if (!context || context.fence.resourceId !== resourceId)
      throw new Error('External cleanup settlement requires its exclusive execution context');
    context.assertCurrent?.();
    this.atomic(() => this.store.save({ ...this.require(context.fence), externalPending: false }));
  }

  reconciled(resourceId: string): void {
    const context = resourceCleanupContext.getStore();
    if (!context || context.fence.resourceId !== resourceId)
      throw new Error('Cleanup reconciliation requires its exclusive execution context');
    context.assertCurrent?.();
    this.atomic(() => {
      const fence = this.require(context.fence);
      if (fence.externalPending)
        throw new Error('External cleanup executor is not verified settled');
      this.store.save({ ...fence, state: 'verified' });
    });
  }

  private finish(fence: ResourceCleanupFence, success: boolean, assertCurrent?: () => void): void {
    this.atomic(() => {
      const current = this.require(fence);
      if (success) assertCurrent?.();
      if ((success && !current.externalPending) || current.state === 'claimed')
        this.db
          .prepare('DELETE FROM settings WHERE key=? AND value=?')
          .run(key(fence.resourceId), JSON.stringify(current));
      else this.store.save({ ...current, state: 'retry' });
    });
    active.delete(fence.token);
    if (this.read(fence.resourceId)) settled.add(fence.token);
    else settled.delete(fence.token);
  }

  runLeased<T>(
    resource: ResourceRecord,
    operationId: string,
    authority: ResourceLease,
    action: () => Promise<T>,
  ): Promise<T> {
    return this.run(resource, operationId, action, false, authority);
  }

  runStop<T>(
    resource: ResourceRecord,
    operationId: string,
    action: () => Promise<T>,
    authority?: ResourceLease,
  ): Promise<T> {
    if (!stopEnvironmentResource(resource))
      throw new Error('Stop fencing requires an exact disposable task environment');
    return this.run(resource, operationId, action, false, authority, 'stop');
  }

  async run<T>(
    resource: ResourceRecord,
    operationId: string,
    action: () => Promise<T>,
    preparation = false,
    authority?: ResourceLease,
    mode: ResourceCleanupFence['mode'] = authority ? 'maintenance' : 'remove',
  ): Promise<T> {
    const fence = claimCleanup(
      this.db,
      this.store,
      this.resource,
      resource,
      operationId,
      preparation,
      authority,
      mode,
    );
    return this.execute(resource, action, fence, !!authority || mode === 'stop');
  }

  /** Cache-only, local filesystem reconciliation with independently granted control capacity. */
  async runCacheReconciliation<T>(
    resource: ResourceRecord,
    operationId: string,
    proof: CacheReconciliationAuthority,
    action: () => Promise<T>,
  ): Promise<T> {
    return this.cacheReconciliation(resource, operationId, proof, action, false);
  }

  /** Read-only closure of one owned, never-started BuildKit allocation; cannot dispatch Docker. */
  runUnstartedBuildkitReconciliation<T>(
    resource: ResourceRecord,
    operationId: string,
    proof: CacheReconciliationAuthority,
    action: () => Promise<T>,
  ): Promise<T> {
    return this.cacheReconciliation(resource, operationId, proof, action, true);
  }

  /** Positive stopped-daemon and closed-client evidence; same read-only, generation-preserving barrier. */
  runStoppedBuildkitReconciliation<T>(
    resource: ResourceRecord,
    operationId: string,
    proof: CacheReconciliationAuthority,
    action: () => Promise<T>,
  ): Promise<T> {
    return this.cacheReconciliation(resource, operationId, proof, action, true);
  }

  private async cacheReconciliation<T>(
    resource: ResourceRecord,
    operationId: string,
    proof: CacheReconciliationAuthority,
    action: () => Promise<T>,
    unstartedBuildkit: boolean,
  ): Promise<T> {
    const { target, fence, assertCurrent } = await prepareCacheReconciliation(
      this.db,
      this.store,
      this.resource,
      resource,
      operationId,
      proof,
      unstartedBuildkit,
    );
    return this.execute(target, action, fence, unstartedBuildkit, assertCurrent, unstartedBuildkit);
  }

  private execute<T>(
    resource: ResourceRecord,
    action: () => Promise<T>,
    fence: ResourceCleanupFence,
    maintenance: boolean,
    assertCurrent?: () => void,
    readOnly = false,
  ): Promise<T> {
    return resourceCleanupContext.run(
      {
        fence,
        readOnly,
        ...(assertCurrent ? { assertCurrent, localOnly: true } : {}),
        effect: (external) => this.effect(resource.id, external),
        settled: () => this.externalSettled(resource.id),
      },
      async () => {
        try {
          const result = await action();
          const current = this.resource(resource.id);
          const saved = this.require(fence);
          const verified =
            !!current &&
            (current.state === 'released' ||
              (current.generation === resource.generation + 1 && saved.state === 'verified') ||
              (maintenance &&
                current.generation === resource.generation &&
                saved.state === 'verified'));
          this.finish(fence, verified, assertCurrent);
          return result;
        } catch (error) {
          this.finish(fence, false);
          throw error;
        }
      },
    );
  }
}
