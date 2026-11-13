import type { ManagedBuilder } from './managed-cache-store';
import { resourceExecution, type HeldResource } from './resource-execution';

/** Keep the exact granted object through late binding and maintenance; never reconstruct it from a row. */
export function managedBuilderAuthority(
  entry: Pick<ManagedBuilder, 'projectId' | 'resourceId' | 'generation'>,
): HeldResource {
  const scope = resourceExecution.getStore(),
    held = scope?.cacheAuthority;
  if (
    !scope?.resources ||
    scope.projectId !== entry.projectId ||
    scope.ownerId !== 'managed-cache:buildkit' ||
    !held ||
    held.isLive?.() !== true
  )
    throw new Error('managed_buildkit_fresh_exclusive_authority_required');
  scope.signal.throwIfAborted();
  const lease = held.lease;
  if (
    lease.projectId !== entry.projectId ||
    lease.ownerId !== scope.ownerId ||
    lease.state !== 'granted' ||
    lease.checkpoint !== 'managed-cache-buildkit' ||
    lease.intentId !== scope.intentId
  )
    throw new Error('managed_buildkit_fresh_granted_lease_required');
  const lock = lease.locks.find((item) => item.resourceId === entry.resourceId);
  if (!lock)
    held.bind([
      ...lease.locks,
      { resourceId: entry.resourceId, generation: entry.generation, mode: 'exclusive' },
    ]);
  else if (lock.generation !== entry.generation || lock.mode !== 'exclusive')
    throw new Error('managed_buildkit_lease_generation_changed');
  return held;
}
