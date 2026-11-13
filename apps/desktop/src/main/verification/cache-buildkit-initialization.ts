import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResourceLease } from '@skaro/core';
import { ManagedCacheStore, type ManagedBuilder } from '../managed-cache-store';
import { canonicalCachePath, readCacheFile } from '../managed-cache-files';
import { encodeNativeIdentity, type ExactNativeIdentity } from '../managed-native-identity';
import { cacheBuildkitHash } from './cache-buildkit-contract';
import { CACHE_VERIFICATION_OWNER_SCOPE as scope } from './cache-verification-scope';
import { requireApprovedBuildkitClient } from './cache-buildkit-approval';

export const INITIALIZATION_INTENT = 'b617b593-efd3-419d-9d5c-fcdb0ba6242f';
export const INITIALIZATION_KEY = `resources.cache-buildkit-initialization.${scope.projectId}.${INITIALIZATION_INTENT}.v1`;
const proofHash = '028d3475a6550095e6cbc6d8faaebdf119ddf5fa927c59608b022bb03894a719';
export interface InitializationJournal {
  proofHash: string;
  entry: ManagedBuilder;
  layout: ExactNativeIdentity[];
  originals: ResourceLease[];
  controls: string[];
  complete: boolean;
}

/** This one failed dispatch never reached binding, a cleanup fence, Docker provisioning or RUN. */
export async function initializationProof(data: string) {
  const path = join(data, 'verification', `cache-buildkit-${INITIALIZATION_INTENT}`, 'proof.json');
  const { data: bytes } = await readCacheFile(data, path, 4 * 1024 ** 2);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), proofHash);
  const proof = JSON.parse(bytes.toString('utf8'));
  assert.equal(proof.intentId, INITIALIZATION_INTENT);
  assert.equal(proof.passed, false);
  assert.equal(proof.cold, undefined);
  assert.equal(proof.warm, undefined);
  assert.deepEqual(proof.foreignBefore, proof.foreignAfter);
  assert.deepEqual(proof.objectsBefore, proof.objectsAfter);
  assert.deepEqual(proof.protectedBefore, proof.protectedAfter);
  return proof as {
    finalLeases: ResourceLease[];
    foreignAfter: unknown;
    objectsAfter: unknown;
    protectedAfter: unknown;
  };
}

export async function emptyInitializationLayout(store: ManagedCacheStore) {
  const root = store.builderPath(scope.projectId),
    child = join(root, 'buildx');
  const identities: ExactNativeIdentity[] = [];
  for (const path of [root, child]) {
    await canonicalCachePath(store.root, path);
    const info = await lstat(path, { bigint: true });
    assert(info.isDirectory() && !info.isSymbolicLink());
    identities.push(encodeNativeIdentity(info));
  }
  assert.deepEqual(await readdir(root), ['buildx']);
  assert.deepEqual(await readdir(child), []);
  return identities;
}

export function initializationEntry(store: ManagedCacheStore, admitted?: ResourceLease) {
  const entry = store.builders().find((item) => item.projectId === scope.projectId);
  assert(entry);
  assert.equal(
    entry.resourceId,
    'resource-4cf91caed15c6186e4c12bea7d911093fa14807988f87c0446ca7bd5ff08cfd1',
  );
  assert.equal(entry.name, 'skaro-owned-9828f69ffb12488a9476e611630d0ce2');
  assert.equal(entry.token, '30b676e3-5232-4d22-b13b-d778dc3d6897');
  assert.equal(entry.generation, 1);
  assert.equal(entry.state, 'creating');
  assert(entry.client);
  requireApprovedBuildkitClient(entry.client);
  for (const field of ['container', 'endpoint', 'consumer', 'bytes'] as const)
    assert.equal(entry[field], undefined);
  const resource = store.current(entry);
  assert.equal(resource.state, 'available');
  if (admitted) {
    assert(store.db.admission.isLive(admitted));
    assert.equal(admitted.projectId, entry.projectId);
    assert.equal(admitted.ownerId, 'managed-cache:buildkit');
    assert.equal(admitted.checkpoint, 'managed-cache-buildkit');
    assert(
      admitted.locks.some(
        (lock) =>
          lock.resourceId === resource.id &&
          lock.generation === resource.generation &&
          lock.mode === 'exclusive',
      ),
    );
  }
  assert.deepEqual(
    resource.consumers,
    admitted
      ? [{ id: `lease:${admitted.id}`, generation: resource.generation, kind: 'unknown' }]
      : [],
  );
  assert.deepEqual(resource.objectIds ?? [], []);
  assert.equal(store.db.resources.cleanup.read(resource.id), undefined);
  return entry;
}

export function requireOriginalInitializationLeases(originals: ResourceLease[]) {
  assert.deepEqual(originals.map((item) => item.id).sort(), [
    '4ada308f-b867-4756-b1a1-db77b3469863',
    '5def22c2-35e4-45c0-b4bf-ce00914d2556',
  ]);
  for (const lease of originals) {
    assert.equal(lease.intentId, INITIALIZATION_INTENT);
    assert.equal(lease.projectId, scope.projectId);
    assert.equal(lease.state, 'retained');
    assert.equal(lease.revision, 3);
    assert.deepEqual(lease.locks, [
      {
        resourceId: 'resource-208b5911e00587ace82dd4cc5ef47302ad033278b3d4087a94e19ba02e2d777a',
        generation: 1,
        mode: 'shared',
      },
    ]);
  }
}

export function sameInitializationLease(
  actual: ResourceLease,
  original: ResourceLease,
  evidence = 'buildkit_initialization_no_dispatch_native_and_docker_proven',
) {
  if (actual.state === 'retained') assert.deepEqual(actual, original);
  else {
    assert.equal(actual.state, 'released');
    assert.equal(actual.revision, original.revision + 1);
    assert.equal(actual.reason, 'teardown_confirmed');
    assert(actual.updatedAt >= original.updatedAt);
    assert.equal(actual.evidence, evidence);
    const immutable = (lease: ResourceLease) => {
      const { state, revision, reason, updatedAt, evidence, ...rest } = lease;
      void state;
      void revision;
      void reason;
      void updatedAt;
      void evidence;
      return cacheBuildkitHash(rest);
    };
    assert.equal(immutable(actual), immutable(original));
  }
}
