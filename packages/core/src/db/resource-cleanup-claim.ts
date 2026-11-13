import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { ResourceRecord } from '../resources/model.ts';
import type { ResourceLease } from '../resources/admission-model.ts';
import { ResourceCleanupBlocked, type ResourceCleanupFence } from '../resources/cleanup-context.ts';
import { CleanupFenceStore } from './resource-cleanup-store.ts';
import { resourceLeaseConsumers } from './admission-consumers.ts';
import { resourceLeaseRecords } from './admission-records.ts';
import {
  cleanupOwner as owner,
  activeCleanupTokens as active,
  settledCleanupTokens as settled,
  cleanupSignature as signature,
  cleanupOwnerExited as dead,
  cleanupAuthorityMatches,
  stopEnvironmentResource,
} from './resource-cleanup-owner.ts';

/** Ordinary claims deliberately never adopt unknown external completion or retained maintenance grants. */
export function claimCleanup(
  db: DatabaseSync,
  store: CleanupFenceStore,
  lookup: (id: string) => ResourceRecord | undefined,
  resource: ResourceRecord,
  operationId: string,
  preparation: boolean,
  authority: ResourceLease | undefined,
  mode: ResourceCleanupFence['mode'],
): ResourceCleanupFence {
  if (mode === 'stop' && !stopEnvironmentResource(resource))
    throw new Error('Stop fencing requires an exact disposable task environment');
  if (!operationId.trim() || /[\r\n\0]/.test(operationId))
    throw new Error('Invalid exact cleanup operation identity');
  return store.atomic(() => {
    const current = lookup(resource.id);
    const preparationConsumer =
      preparation && mode === 'remove' && ['task', 'integration'].includes(resource.owner.kind)
        ? `runtime:${resource.projectId}:${resource.owner.id}`
        : undefined;
    const lease = authority && resourceLeaseRecords(db).find((lease) => lease.id === authority.id);
    if (authority && !cleanupAuthorityMatches(db, resource, lease, authority, mode))
      throw new Error(
        'Cleanup maintenance requires its current exact exclusive lease or owned review stop authority',
      );
    const authorityConsumer = lease && `lease:${lease.id}`;
    if (
      !current ||
      current.generation !== resource.generation ||
      signature(current) !== signature(resource) ||
      current.ownership !== 'registered' ||
      !['disposable', 'reproducible'].includes(current.preservation) ||
      current.consumers.some(
        (consumer) =>
          consumer.id !== authorityConsumer &&
          (consumer.id !== preparationConsumer || consumer.kind !== 'unknown'),
      ) ||
      resourceLeaseConsumers(db, resource.id).some((consumer) => consumer.id !== authorityConsumer)
    )
      throw new ResourceCleanupBlocked(
        'cleanup_inputs_changed',
        'Resource cleanup ownership or consumers changed',
      );
    const overlapping = store.blocking(resource.identity, resource.objectIds);
    if (overlapping && overlapping.resourceId !== resource.id)
      throw new Error('Resource cleanup conflicts with another exact fenced resource');
    const old = store.read(resource.id);
    if (old) {
      if (
        old.operationId !== operationId ||
        old.mode !== mode ||
        old.generation !== resource.generation ||
        old.signature !== signature(resource) ||
        !isDeepStrictEqual(old.identity, resource.identity)
      )
        throw new ResourceCleanupBlocked(
          'cleanup_operation_changed',
          'Resource cleanup belongs to another operation or generation',
        );
      if (old.authorityLeaseId !== authority?.id)
        throw new Error('Cleanup maintenance authority changed before reconciliation');
      if (old.externalPending)
        throw new ResourceCleanupBlocked(
          'cleanup_external_executor_unverified',
          'Cleanup external executor is unverified; explicit reconciliation required',
        );
      const sameSettledExecution =
        old.owner === owner && settled.has(old.token) && !active.has(old.token);
      if (!sameSettledExecution && !dead(old.pid))
        throw new ResourceCleanupBlocked(
          'cleanup_owner_unverified',
          'Resource cleanup is owned by a live or unverified execution',
        );
    }
    const fence: ResourceCleanupFence = {
      resourceId: resource.id,
      generation: resource.generation,
      operationId,
      mode,
      token: randomUUID(),
      owner,
      pid: process.pid,
      externalPending: false,
      ...(authority ? { authorityLeaseId: authority.id } : {}),
      identity: resource.identity,
      objectIds: [...new Set([...(resource.objectIds ?? []), ...(current.objectIds ?? [])])],
      signature: signature(resource),
      state: old?.state === 'claimed' ? 'claimed' : old ? 'retry' : 'claimed',
    };
    if (old) settled.delete(old.token);
    store.save(fence);
    active.add(fence.token);
    return fence;
  });
}
