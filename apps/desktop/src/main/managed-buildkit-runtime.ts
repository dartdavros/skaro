import { managedBuilderAuthority } from './managed-buildkit-authority';
import { resourceExecution, resourcesFor } from './resource-execution';
import { ManagedCacheStore, type ManagedBuilder } from './managed-cache-store';
import {
  builderCommand,
  builderExternal,
  inspectBuilder,
  inspectOwnedBuilderContainer,
} from './managed-buildkit-identity';
import { cacheProcessAbsent } from './managed-cache-metadata';
import { processBirth } from '@skaro/agent-runtime/process-identity';

export interface BuildkitUsage {
  bytes: number;
  inUse: boolean;
}
/** Humanized, absent and overflowed costs are unknown, never zero. */
export function buildkitUsage(text: string): BuildkitUsage {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('managed_buildkit_usage_unknown');
  }
  // buildctl marshals a nil UsageInfo slice as JSON null; this is its documented empty result.
  if (data === null) data = [];
  if (!Array.isArray(data)) throw new Error('managed_buildkit_usage_unknown');
  let bytes = 0,
    inUse = false;
  for (const record of data) {
    if (!record || typeof record !== 'object') throw new Error('managed_buildkit_usage_unknown');
    const value = record as { size?: unknown; inUse?: unknown };
    if (
      !Number.isSafeInteger(value.size) ||
      Number(value.size) < 0 ||
      typeof value.inUse !== 'boolean'
    )
      throw new Error('managed_buildkit_usage_unknown');
    bytes += Number(value.size);
    inUse ||= value.inUse;
  }
  if (!Number.isSafeInteger(bytes)) throw new Error('managed_buildkit_usage_unknown');
  return { bytes, inUse };
}

/** The exact exclusive lease/fence remains held through verified idle daemon stop, including cancellation. */
export class ManagedBuildkitRuntime {
  private readonly store: ManagedCacheStore;
  constructor(store: ManagedCacheStore) {
    this.store = store;
  }
  async usage(entry: ManagedBuilder, teardown = false) {
    managedBuilderAuthority(entry);
    // Buildx may bootstrap a stopped driver: never dispatch it through the cancellation-only stop escape.
    if (teardown && resourceExecution.getStore()?.signal.aborted)
      throw new Error('managed_buildkit_cancelled_idle_probe_requires_explicit_reconciliation');
    if (!(await inspectBuilder(this.store, entry, teardown)).running)
      throw new Error('managed_buildkit_usage_requires_running_daemon');
    return buildkitUsage(
      await builderCommand(
        this.store,
        entry,
        [
          'container',
          'exec',
          entry.container!,
          'buildctl',
          '--addr',
          'unix:///run/buildkit/buildkitd.sock',
          'du',
          '--format',
          '{{json .}}',
        ],
        teardown,
      ),
    );
  }
  async maintain<T>(
    entry: ManagedBuilder,
    action: () => Promise<T>,
    cleanup?: () => Promise<void>,
  ): Promise<T> {
    const { store } = this,
      held = managedBuilderAuthority(entry),
      resource = store.current(entry);
    const authority = held.lease;
    let result: T | undefined, failure: unknown;
    await store.db.resources.cleanup.runLeased(
      resource,
      `cache.maintain:${resource.id}:${entry.generation}`,
      authority,
      async () => {
        const birth = await processBirth(process.pid);
        if (!birth) throw new Error('managed_buildkit_actor_identity_unverified');
        entry.consumer = {
          intent: resourceExecution.getStore()!.intentId,
          pid: process.pid,
          birth,
        };
        store.saveBuilder(entry);
        try {
          result = await action();
        } catch (error) {
          failure = error;
          entry.bytes = undefined;
        }
        try {
          if (failure || resourceExecution.getStore()?.signal.aborted) {
            // Never bootstrap, probe DU, prune or restart through cancellation-only authority.
            // The remote driver cannot start our stopped daemon; still retain ambiguous RPC/disk state.
            const owned = await inspectOwnedBuilderContainer(store, entry, true);
            if (owned.observed.running)
              await builderExternal(
                store,
                entry,
                ['container', 'stop', '--time', '15', owned.observed.container],
                true,
              );
            if ((await inspectOwnedBuilderContainer(store, entry, true)).observed.running)
              throw new Error('managed_buildkit_stop_unconfirmed');
            entry.bytes = undefined;
            entry.state = 'retained';
            store.saveBuilder(entry);
            store.outcome(
              entry,
              'retained',
              'managed_buildkit_compute_stopped_disk_or_executor_unsettled',
            );
            throw new Error('managed_buildkit_stopped_requires_explicit_reconciliation', {
              cause: failure,
            });
          }
          const observed = await inspectBuilder(store, entry, true);
          const pid = entry.consumer?.pid;
          const usage = observed.running ? await this.usage(entry, true) : undefined;
          if ((pid && pid !== process.pid && !cacheProcessAbsent(pid)) || usage?.inUse)
            throw new Error('managed_buildkit_executor_or_idle_unverified');
          if (usage) entry.bytes = usage.bytes;
          if (observed.running)
            await builderExternal(
              store,
              entry,
              ['container', 'stop', '--time', '15', observed.container],
              true,
            );
          if ((await inspectBuilder(store, entry, true)).running)
            throw new Error('managed_buildkit_stop_unconfirmed');
          // After a failed client command, settled means both client exit and actual idle/stopped daemon were proved.
          store.db.resources.cleanup.externalSettled(entry.resourceId);
          await cleanup?.();
          entry.state = 'ready';
          entry.consumer = undefined;
          store.saveBuilder(entry);
          store.db.resources.cleanup.reconciled(entry.resourceId);
          store.outcome(entry, 'observed', 'managed_buildkit_idle_daemon_stopped');
        } catch (error) {
          entry.state = 'retained';
          store.saveBuilder(entry);
          store.outcome(entry, 'retained', 'managed_buildkit_executor_identity_or_idle_unverified');
          throw error;
        }
      },
    );
    if (failure) {
      store.outcome(entry, 'retained', 'managed_buildkit_operation_failed_runtime_stopped');
      throw failure;
    }
    return result as T;
  }
  async stop(projectId: string) {
    const entry = this.store.builders().find((x) => x.projectId === projectId);
    if (!entry) return;
    const resources = resourcesFor(this.store.db),
      held = resources?.holdings(projectId, 'managed-cache:buildkit');
    if (held?.some((x) => x.lease.state === 'retained'))
      throw new Error('managed_buildkit_retained_runtime_requires_explicit_reconciliation');
    if (this.store.db.resources.cleanup.read(entry.resourceId))
      throw new Error('managed_buildkit_pending_fence_requires_explicit_reconciliation');
    const observed = await inspectBuilder(this.store, entry, true);
    if (!observed.running) return; // Read-only verification, never adopts or restarts an old builder.
    await this.maintain(entry, async () => undefined);
  }
}
