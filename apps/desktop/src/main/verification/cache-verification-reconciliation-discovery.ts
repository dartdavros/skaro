import type { AppDb } from '@skaro/core';
import { ManagedCacheStore } from '../managed-cache-store';
import { CACHE_VERIFICATION_OWNER_SCOPE as scope } from './cache-verification-scope';
import {
  requireReconciliationIntent,
  reconciliationAttempt,
} from './cache-verification-reconciliation-identity';
import { assertReplayOriginal } from './cache-verification-reconciliation-replay-original';
import { preservedReconciliationDatabase } from './cache-verification-reconciliation-preserved';

/** Explicit failed intent selects only a host catalogue/ledger candidate; strict domain proof follows. */
export function discoverReconciliationSnapshot(
  db: AppDb,
  store: ManagedCacheStore,
  project: { projectId: typeof scope.projectId; root: string; head: string },
  failedIntent: string,
  observedAt: number,
) {
  requireReconciliationIntent(failedIntent);
  const entries = store.artifacts().filter((entry) => entry.projectId === scope.projectId);
  const candidates = entries.filter((entry) => entry.consumer?.intent === failedIntent);
  if (
    candidates.length !== 1 ||
    store.builders().some((entry) => entry.projectId === scope.projectId)
  )
    throw new Error('cache_reconciliation_failed_publication_candidate');
  const entry = candidates[0]!;
  const leases = db.admission
    .all()
    .filter((lease) => lease.projectId === scope.projectId && lease.intentId === failedIntent);
  const sourceLease = leases.find(
    (lease) =>
      lease.ownerId === 'cache-verification:source' &&
      lease.checkpoint === 'cache-verification-real-source',
  );
  const dependenciesLease = leases.find(
    (lease) =>
      lease.ownerId === 'managed-cache:dependencies' &&
      lease.checkpoint === 'managed-cache-dependencies',
  );
  if (leases.length !== 2 || !sourceLease || !dependenciesLease)
    throw new Error('cache_reconciliation_original_reservations_missing');
  const sourceLock = sourceLease.locks.find((lock) => lock.mode === 'shared');
  const stageLock = dependenciesLease.locks.find((lock) => lock.mode === 'exclusive');
  if (!sourceLock || !stageLock) throw new Error('cache_reconciliation_original_locks_missing');
  const resource = store.current(entry),
    stageResource = db.resources.get(stageLock.resourceId),
    sourceResource = db.resources.get(sourceLock.resourceId);
  if (!stageResource || !sourceResource)
    throw new Error('cache_reconciliation_original_resources_missing');
  const stageFence = db.resources.cleanup.read(stageResource.id);
  if (!stageFence) throw new Error('cache_reconciliation_original_fence_missing');
  const outcomes = db.resources
    .outcomes(resource.id, 1000)
    .filter((outcome) => outcome.generation === resource.generation);
  const original = {
    entry,
    resource,
    stageResource,
    sourceResource,
    sourceLease,
    dependenciesLease,
    stageFence,
    outcomes,
  };
  assertReplayOriginal({
    version: 2,
    createdAt: observedAt,
    storeRoot: store.root,
    project,
    original,
  });
  const attempt = reconciliationAttempt(original);
  const preserved = preservedReconciliationDatabase(db, entries, original);
  if (
    preserved.leases.some(
      (lease) => !['released', 'cancelled', 'stopped_by_owner'].includes(lease.state),
    )
  )
    throw new Error('cache_reconciliation_unrelated_active_lease');
  for (const item of [resource, sourceResource])
    if (db.resources.cleanup.blocking(item))
      throw new Error('cache_reconciliation_unexpected_overlapping_fence');
  if (JSON.stringify(db.resources.cleanup.blocking(stageResource)) !== JSON.stringify(stageFence))
    throw new Error('cache_reconciliation_stage_overlap_changed');
  return { ...original, attempt, preserved };
}
