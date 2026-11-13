import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { AppDb, ResourceLease, ResourceRecord } from '@skaro/core';
import { readCacheFile } from '../managed-cache-files';
import { CREATED_INTENT } from './cache-buildkit-created-inspection';
import type { inspectCreatedBuildkit } from './cache-buildkit-created-inspection';
import type { resourceInventory } from './resource-workflow-observation';

export const CREATED_EVIDENCE = 'buildkit_created_never_started_empty_volume_physically_verified';
export interface CreatedJournal {
  observed: Awaited<ReturnType<typeof inspectCreatedBuildkit>>;
  inventory: Awaited<ReturnType<typeof resourceInventory>>;
  objects: Record<string, string>;
  resource: ResourceRecord;
  fence: NonNullable<ReturnType<AppDb['resources']['cleanup']['read']>>;
  originals: ResourceLease[];
  controls: string[];
  complete: boolean;
}

export async function createdFailedProof(data: string) {
  const { data: bytes } = await readCacheFile(
    data,
    join(data, 'verification', `cache-buildkit-${CREATED_INTENT}`, 'proof.json'),
    4 * 1024 ** 2,
  );
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    '6bdd0caaa816e0e26839b0c3830f0b6dd8e3f13065dbab584ae6e8fdd6e159ae',
  );
  const proof = JSON.parse(bytes.toString('utf8'));
  assert.equal(proof.passed, false);
  assert.equal(proof.intentId, CREATED_INTENT);
  assert.equal(proof.cold, undefined);
  assert.equal(proof.warm, undefined);
  assert.deepEqual(proof.finalLeases.map((lease: ResourceLease) => lease.id).sort(), [
    '4298829b-1f19-4c6c-9a52-f1741103d4c6',
    'c631935f-6ce6-4ddf-a2f4-d61cd769afe3',
  ]);
  return proof as { protectedBefore: unknown; finalLeases: ResourceLease[] };
}
