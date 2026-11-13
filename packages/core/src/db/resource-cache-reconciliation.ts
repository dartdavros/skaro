import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { ResourceRecord, ResourceConsumer } from '../resources/model.ts';
import type { ResourceLease } from '../resources/admission-model.ts';
import type { ResourceCleanupFence } from '../resources/cleanup-context.ts';
import { CleanupFenceStore } from './resource-cleanup-store.ts';
import { resourceLeaseConsumers } from './admission-consumers.ts';
import { resourceLeaseRecords } from './admission-records.ts';
import { isLiveResourceGrant } from './resource-live-grant.ts';
import {
  cleanupOwner,
  activeCleanupTokens,
  settledCleanupTokens,
  cleanupSignature,
  cleanupOwnerExited,
} from './resource-cleanup-owner.ts';

/** Host callback, not a serialized approval flag. It must verify domain executor receipts and physical data. */
export interface CacheReconciliationAuthority {
  controller: ResourceLease;
  fence: ResourceCleanupFence | undefined;
  consumers: ResourceConsumer[];
  retained: ResourceLease[];
  verifyClosed(): Promise<void>;
}
export function assertCacheReconciliationController(db: DatabaseSync, expected: ResourceLease) {
  const actual = resourceLeaseRecords(db).find((lease) => lease.id === expected.id);
  if (
    !isLiveResourceGrant(db, expected) ||
    !isDeepStrictEqual(actual, expected) ||
    expected.ownerId !== 'managed-cache:reconciliation' ||
    expected.checkpoint !== 'cache-reconciliation' ||
    expected.cost.ramBytes <= 0 ||
    expected.cost.model ||
    expected.cost.environment ||
    expected.cost.build ||
    expected.cost.review
  )
    throw new Error('Cache reconciliation requires its fresh live control lease');
}
/** Snapshot host inputs before awaiting domain evidence; returned authority still checks the live grant. */
export async function prepareCacheReconciliation(
  db: DatabaseSync,
  store: CleanupFenceStore,
  lookup: (id: string) => ResourceRecord | undefined,
  resource: ResourceRecord,
  operationId: string,
  proof: CacheReconciliationAuthority,
  unstartedBuildkit: boolean,
) {
  const controller = proof.controller;
  const captured = {
    controller,
    fence: structuredClone(proof.fence),
    consumers: structuredClone(proof.consumers),
    retained: structuredClone(proof.retained),
    verifyClosed: proof.verifyClosed,
  };
  const target = structuredClone(resource);
  assertCacheReconciliationController(db, controller);
  if (typeof captured.verifyClosed !== 'function')
    throw new Error('Cache reconciliation requires host executor and physical verification');
  await captured.verifyClosed();
  const fence = claimCacheReconciliation(
    db,
    store,
    lookup,
    target,
    operationId,
    captured,
    unstartedBuildkit,
  );
  return {
    target,
    fence,
    assertCurrent: () => assertCacheReconciliationController(db, controller),
  };
}
/** No capacity handoff, grant resurrection, TTL or PID-only settlement. Old reservations remain untouched. */
export function claimCacheReconciliation(
  db: DatabaseSync,
  store: CleanupFenceStore,
  lookup: (id: string) => ResourceRecord | undefined,
  resource: ResourceRecord,
  operationId: string,
  proof: CacheReconciliationAuthority,
  unstartedBuildkit = false,
): ResourceCleanupFence {
  return store.atomic(() => {
    assertCacheReconciliationController(db, proof.controller);
    if (
      proof.controller.projectId !== resource.projectId ||
      !operationId.trim() ||
      /[\r\n\0]/.test(operationId)
    )
      throw new Error('Cache reconciliation project or operation changed');
    const current = lookup(resource.id),
      old = store.read(resource.id);
    if (
      !current ||
      !isDeepStrictEqual(current, resource) ||
      current.kind !== 'cache' ||
      (unstartedBuildkit
        ? current.state !== 'available' ||
          current.source?.recovery !== 'skaro:owned-isolated-remote-buildkit-v3' ||
          current.objectIds?.length !== 1 ||
          !/^[a-f0-9]{64}$/.test(current.objectIds[0]!) ||
          proof.retained.length !== 1 ||
          !old ||
          old.objectIds.some((id) => !current.objectIds?.includes(id)) ||
          old.mode !== 'maintenance' ||
          old.externalPending ||
          operationId !== `cache.maintain:${current.id}:${current.generation}`
        : (current.objectIds?.length ?? 0) !== 0) ||
      current.owner.kind !== 'project' ||
      current.owner.id !== current.projectId ||
      current.purpose !== 'cache' ||
      current.ownership !== 'registered' ||
      current.preservation !== 'reproducible' ||
      !['available', 'released'].includes(current.state) ||
      (current.state === 'released' && current.consumers.length !== 0) ||
      proof.retained.length > 1 ||
      !isDeepStrictEqual(current.consumers, proof.consumers) ||
      !isDeepStrictEqual(old, proof.fence)
    )
      throw new Error('Cache reconciliation exact snapshot changed');
    const overlapping = store.blocking(resource.identity, resource.objectIds);
    if (overlapping && overlapping.resourceId !== resource.id)
      throw new Error('Cache reconciliation overlaps another resource');
    const records = resourceLeaseRecords(db),
      allowed = new Set<string>();
    for (const expected of proof.retained) {
      const actual = records.find((lease) => lease.id === expected.id);
      if (
        !isDeepStrictEqual(actual, expected) ||
        expected.projectId !== resource.projectId ||
        expected.state !== 'retained' ||
        expected.cost.model ||
        (unstartedBuildkit
          ? expected.ownerId !== 'managed-cache:buildkit' ||
            expected.checkpoint !== 'managed-cache-buildkit' ||
            expected.cost.environment !== 1 ||
            expected.cost.build !== 1
          : expected.cost.environment) ||
        expected.cost.review ||
        !expected.locks.some(
          (lock) =>
            lock.resourceId === resource.id &&
            lock.generation === resource.generation &&
            lock.mode === 'exclusive',
        )
      )
        throw new Error('Cache reconciliation retained reservation changed');
      allowed.add(`lease:${expected.id}`);
    }
    if (
      resourceLeaseConsumers(db, resource.id).some((consumer) => !allowed.has(consumer.id)) ||
      current.consumers.some((consumer) => !allowed.has(consumer.id) && consumer.kind !== 'copy')
    )
      throw new Error('Cache reconciliation has an unrelated or unknown consumer');
    if (old) {
      if (
        old.mode === 'stop' ||
        old.operationId !== operationId ||
        old.generation !== resource.generation ||
        old.signature !== cleanupSignature(resource) ||
        !isDeepStrictEqual(old.identity, resource.identity) ||
        (old.authorityLeaseId && !allowed.has(`lease:${old.authorityLeaseId}`))
      )
        throw new Error('Cache reconciliation fence authority changed');
      const local =
        old.owner === cleanupOwner &&
        settledCleanupTokens.has(old.token) &&
        !activeCleanupTokens.has(old.token);
      if (!local && !cleanupOwnerExited(old.pid))
        throw new Error('Cache reconciliation owner is live or unverified');
    }
    const fence: ResourceCleanupFence = {
      resourceId: resource.id,
      generation: resource.generation,
      operationId,
      mode: unstartedBuildkit ? 'maintenance' : (old?.mode ?? 'remove'),
      token: randomUUID(),
      owner: cleanupOwner,
      pid: process.pid,
      identity: resource.identity,
      objectIds: resource.objectIds ?? [],
      signature: cleanupSignature(resource),
      externalPending: false,
      ...((old?.authorityLeaseId ?? proof.retained[0]?.id)
        ? { authorityLeaseId: old?.authorityLeaseId ?? proof.retained[0]!.id }
        : {}),
      state: 'retry',
    };
    if (old) settledCleanupTokens.delete(old.token);
    store.save(fence);
    activeCleanupTokens.add(fence.token);
    return fence;
  });
}
