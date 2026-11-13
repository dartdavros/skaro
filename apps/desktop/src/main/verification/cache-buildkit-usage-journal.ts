import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { AppDb, ResourceLease } from '@skaro/core';
import { readCacheFile } from '../managed-cache-files';
import type { ManagedCacheStore } from '../managed-cache-store';
import { CACHE_BUILDKIT_OWNER_APPROVAL as owner } from './cache-buildkit-approval';
import { inspectStoppedBuildkit } from './cache-buildkit-stopped-journal';

export const USAGE_INTENT = '67e75deb-f3cf-4505-b3e9-a456765c82ab';
export const USAGE_KEY = `resources.cache-buildkit-stopped.${owner.projectId}.${USAGE_INTENT}.v1`;
export async function usageFailedProof(data: string, db: AppDb) {
  const { data: bytes } = await readCacheFile(
    data,
    join(data, 'verification', `cache-buildkit-${USAGE_INTENT}`, 'proof.json'),
    4 * 1024 ** 2,
  );
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    '211b71798a72a869287fb57bd5d0e451ab66de162b36e298e1ae061e2c16ad2e',
  );
  const proof = JSON.parse(bytes.toString('utf8'));
  assert.equal(proof.passed, false);
  assert.equal(proof.intentId, USAGE_INTENT);
  assert.equal(proof.initialization, undefined);
  assert.equal(proof.cold, undefined);
  assert.equal(proof.warm, undefined);
  assert(proof.scenarioError.causes.includes('managed_buildkit_usage_unknown'));
  assert.deepEqual(proof.protectedBefore, proof.protectedAfter);
  assert.deepEqual(proof.foreignBefore, proof.foreignAfter);
  assert.deepEqual(proof.objectsBefore, proof.objectsAfter);
  const leases = proof.finalLeases as ResourceLease[];
  assert.deepEqual(leases.map((lease) => lease.id).sort(), [
    '06205845-d4b6-4a67-8ee1-fb60caf84e58',
    '41b0c86e-8331-478b-adb9-315a89f63bd9',
  ]);
  assert(leases.every((lease) => lease.state === 'retained'));
  if (!db.getSetting(USAGE_KEY, undefined)) {
    const target = leases
      .flatMap((lease) => lease.locks)
      .find((lock) => lock.mode === 'exclusive')!;
    const fence = db.resources.cleanup.read(target.resourceId);
    assert(fence && fence.pid === 3112 && !fence.externalPending);
  }
  return { protectedBefore: proof.protectedBefore as unknown, finalLeases: leases };
}
export const inspectUsageStoppedBuildkit = (store: ManagedCacheStore) =>
  inspectStoppedBuildkit(store, '41b0c86e-8331-478b-adb9-315a89f63bd9');
