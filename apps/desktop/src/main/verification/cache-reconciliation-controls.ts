import assert from 'node:assert/strict';
import type { AppDb, ResourceCost, ResourceLeaseRequest } from '@skaro/core';

export const cacheReconciliationControlCost = (): ResourceCost => ({
  ramBytes: 128 * 1024 ** 2,
  cpuMillis: 500,
  model: 0,
  environment: 0,
  build: 0,
  review: 0,
  diskBytes: {},
});

/** Called only after the caller's positive, current domain-closure verification. No executor effects. */
export function settleClosedCacheControls(
  db: AppDb,
  expected: {
    projectId: string;
    intentId: string;
    ids: string[];
    locks: ResourceLeaseRequest['locks'];
  },
  current?: string,
) {
  for (const id of expected.ids) {
    if (id === current) continue;
    const lease = db.admission.get(expected.projectId, id);
    if (!lease || ['released', 'cancelled'].includes(lease.state)) continue;
    assert.equal(lease.ownerId, 'managed-cache:reconciliation');
    assert.equal(lease.checkpoint, 'cache-reconciliation');
    assert.equal(lease.intentId, expected.intentId);
    assert.deepEqual(lease.locks, expected.locks);
    assert.deepEqual(lease.cost, cacheReconciliationControlCost());
    if (['waiting_resource', 'waiting_quota'].includes(lease.state))
      db.admission.cancel(
        expected.projectId,
        id,
        lease.revision,
        'closed_cache_control_never_granted',
      );
    else
      db.admission.release(
        expected.projectId,
        id,
        lease.revision,
        Object.fromEntries(lease.locks.map((lock) => [lock.resourceId, lock.generation])),
        'host_read_only_cache_control_closed_without_external_dispatch',
      );
  }
}
