import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { AppDb, ResourceLease } from '@skaro/core';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import { cacheProcessAbsent } from '../managed-cache-metadata';
import { cacheTree, readCacheFile } from '../managed-cache-files';
import { frozenManagedBuildDigest } from '../managed-build-input';
import { inspectManagedBuildSource, type ManagedBuildSource } from '../managed-build-source';
import type { ManagedCacheStore } from '../managed-cache-store';
import {
  requireApprovedBuildkitSnapshot,
  CACHE_BUILDKIT_OWNER_APPROVAL as owner,
} from './cache-buildkit-approval';
import { inspectCreatedBuildkit } from './cache-buildkit-created-inspection';

export const STOPPED_INTENT = '26789bd3-4855-47d7-bb42-36053b483fef';
export const STOPPED_KEY = `resources.cache-buildkit-stopped.${owner.projectId}.${STOPPED_INTENT}.v1`;
export const STOPPED_EVIDENCE =
  'buildkit_stopped_daemon_closed_rpc_and_frozen_source_physically_verified';
const sources = new WeakMap<ManagedCacheStore, ManagedBuildSource>();

export async function stoppedFailedProof(data: string, db: AppDb) {
  const { data: bytes } = await readCacheFile(
    data,
    join(data, 'verification', `cache-buildkit-${STOPPED_INTENT}`, 'proof.json'),
    4 * 1024 ** 2,
  );
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    '2bcbb693e916c20faf8c0b63b2b6628bb4cfcd44c81da850698c9699aee8c4bc',
  );
  const proof = JSON.parse(bytes.toString('utf8'));
  assert.equal(proof.passed, false);
  assert.equal(proof.intentId, STOPPED_INTENT);
  assert.equal(proof.initialization.initialBytes, 0);
  assert.equal(proof.cold, undefined);
  assert.equal(proof.warm, undefined);
  assert.deepEqual(proof.protectedBefore, proof.protectedAfter);
  const leases = proof.finalLeases as ResourceLease[];
  const closed = leases.find((lease) => lease.id === 'dec958f8-6693-4078-863d-20445905a38a')!;
  assert.equal(closed.state, 'released');
  assert.deepEqual(db.admission.get(owner.projectId, closed.id), closed);
  const retained = leases.filter((lease) => lease.state === 'retained');
  assert.deepEqual(retained.map((lease) => lease.id).sort(), [
    '4272134a-4ff8-48bc-8c3b-44dd97e68b3a',
    '6af25ccf-e3fb-431c-b9f5-a3d69e4b0452',
  ]);
  if (!db.getSetting(STOPPED_KEY, undefined)) {
    const fence = db.resources.cleanup.read(
      retained[0]!.locks.find((lock) => lock.mode === 'exclusive')?.resourceId ??
        retained[1]!.locks.find((lock) => lock.mode === 'exclusive')!.resourceId,
    );
    assert(fence && fence.pid === 21792 && !fence.externalPending);
  }
  return { protectedBefore: proof.protectedBefore as unknown, finalLeases: retained };
}

/** Closed client + stopped exact daemon + settled RPC barrier + preserved full bytes; never PID-only. */
export async function inspectStoppedBuildkit(
  store: ManagedCacheStore,
  authorityLeaseId = '4272134a-4ff8-48bc-8c3b-44dd97e68b3a',
) {
  const observed = await inspectCreatedBuildkit(store, 'stopped'),
    consumer = observed.entry.consumer;
  assert.deepEqual(consumer, { intent: STOPPED_INTENT, pid: 21792, birth: '639301298253554015' });
  if (!cacheProcessAbsent(consumer!.pid)) {
    const actualBirth = await processBirth(consumer!.pid);
    assert(actualBirth && actualBirth !== consumer!.birth);
  }
  const fence = store.db.resources.cleanup.read(observed.entry.resourceId);
  if (fence) {
    assert.equal(fence.externalPending, false);
    assert.equal(fence.authorityLeaseId, authorityLeaseId);
    if (fence.pid !== process.pid && fence.pid !== consumer!.pid)
      assert(cacheProcessAbsent(fence.pid));
  }
  let source = sources.get(store);
  if (!source) {
    source = await inspectManagedBuildSource(owner.contextRoot);
    requireApprovedBuildkitSnapshot(source);
    sources.set(store, source);
  }
  const context = await cacheTree(
    store.root,
    join(store.builderPath(owner.projectId), 'context'),
    source.bytes,
  );
  return {
    ...observed,
    originalSourceDigest: source.sourceDigest,
    frozenDigest: frozenManagedBuildDigest(context, source),
    contextDigest: context.digest,
  };
}
