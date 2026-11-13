import assert from 'node:assert/strict';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { AppDb, ResourceLease, ResourceRecord } from '@skaro/core';
import type { ManagedArtifact } from '../managed-cache-store';
import { assertReconciliationResourceBinding } from './cache-verification-reconciliation-layout';
import { CACHE_VERIFICATION_OWNER_SCOPE as scope } from './cache-verification-scope';

/** Explicit owner-approved archive/abandon case, NOT a producer-root adoption capability. */
export const SIXTH_ARCHIVE = Object.freeze({
  intent: 'dec8f960-57e1-48eb-ac7b-2eb2c5089c43',
  key: '102fa58971c4f254c22bceffde0ef3633f76d495eec918875631604069290a97',
  producerDigest: '08f81b618e6fdce8ac88c5129cdb66628e5395b5896f267b45de92dbc16789ad',
  digest: '03d61d409d764e2aef1e8f6583520b2c3bac23fe39e139c2cc4e7effaff643bb',
  artifactId: 'resource-31556e4b16f42176c5ce93a50972c6e3370edc365d2ebb0e1fef50b0d2ecba42',
  sourceId: 'resource-208b5911e00587ace82dd4cc5ef47302ad033278b3d4087a94e19ba02e2d777a',
  sourceLeaseId: '9e0a4e3a-9b4a-4ade-b0fe-1aa11b9d73a3',
  dependencyLeaseId: 'd190e8b9-e78f-416b-8105-24328af1a0ed',
  pid: 17696,
  birth: '639301149613328549',
  bytes: 28002625,
  approval: 'preserve-complete-copy-before-delete',
  diskBytes: 256 * 1024 ** 2,
});
export const SIXTH_ARCHIVE_KEY = `resources.cache-archive-reconciliation.${scope.projectId}.${SIXTH_ARCHIVE.intent}.v1`;
export interface SixthArchiveOriginal {
  entry: ManagedArtifact;
  resource: ResourceRecord;
  stageResource: ResourceRecord;
  sourceResource: ResourceRecord;
  sourceLease: ResourceLease;
  dependenciesLease: ResourceLease;
  stageFence: NonNullable<ReturnType<AppDb['resources']['cleanup']['read']>>;
  outcomes: ReturnType<AppDb['resources']['outcomes']>;
}
export function assertSixthOriginal(original: SixthArchiveOriginal, storeRoot: string) {
  const a = SIXTH_ARCHIVE,
    e = original.entry;
  assert.equal(e.key, a.key);
  assert.equal(e.resourceId, a.artifactId);
  assert.equal(e.manager, 'pnpm');
  assert.equal(e.projectId, scope.projectId);
  assert.equal(e.generation, 1);
  assert.equal(e.state, 'retained');
  assert.equal(e.immutable, false);
  assert.equal(e.bytes, a.bytes);
  assert.equal(e.digest, a.digest);
  assert.equal(e.expandedBytes, 9468521);
  assert.equal(e.expandedFiles, 1925);
  assert.equal(e.expansionPolicy, 'pnpm-isolated-unique-nodes-v2');
  assert.deepEqual(e.consumer, { intent: a.intent, pid: a.pid, birth: a.birth });
  assert.deepEqual(e.installTarget, {
    path: join(storeRoot, 'scratch', `${a.key}-1-original-lock-proof`, 'node_modules'),
    dev: 1961391276,
    ino: 13229323907920232,
    birthtimeMs: 1794518653338.6357,
  }); // Historical diagnostic only. NEVER used to authorize deleting the replacement root.
  assert.equal(original.resource.id, a.artifactId);
  assert.equal(original.sourceResource.id, a.sourceId);
  for (const resource of [original.resource, original.stageResource, original.sourceResource]) {
    assert.equal(resource.projectId, scope.projectId);
    assert.equal(resource.generation, 1);
    assert.equal(resource.state, 'available');
  }
  assertReconciliationResourceBinding(original.resource, join(storeRoot, 'dependencies', a.key), {
    recovery: 'skaro:pnpm-10.11-public-sha512-store-v10-v1',
    dataVersion: a.key,
  });
  const stage = original.stageResource;
  assert.equal(
    stage.identity.path,
    join(storeRoot, 'verification-inputs', stage.identity.path!.split(/[\\/]/).at(-1)!),
  );
  assertReconciliationResourceBinding(stage, stage.identity.path!, {
    recovery: 'skaro:verified-original-pnpm-input-v1',
    dataVersion: stage.source!.dataVersion!,
  });
  assertReconciliationResourceBinding(
    original.sourceResource,
    scope.root,
    {
      recovery: 'skaro:registered-project-root-read-v1',
      dataVersion: original.sourceResource.source!.dataVersion!,
    },
    true,
  );
  for (const [lease, id, owner] of [
    [original.sourceLease, a.sourceLeaseId, 'cache-verification:source'],
    [original.dependenciesLease, a.dependencyLeaseId, 'managed-cache:dependencies'],
  ] as const) {
    assert.equal(lease.id, id);
    assert.equal(lease.ownerId, owner);
    assert.equal(lease.intentId, a.intent);
    assert.equal(lease.projectId, scope.projectId);
    assert.equal(lease.revision, 3);
    assert.equal(lease.state, 'retained');
    assert.equal(lease.reason, 'external_state_requires_reconciliation');
    assert.equal(lease.cost.model, 0);
    assert.equal(lease.cost.environment, 0);
    assert.equal(lease.cost.review, 0);
  }
  const shared = { resourceId: a.sourceId, generation: 1, mode: 'shared' };
  assert.deepEqual(original.sourceLease.locks, [shared]);
  assert.deepEqual(original.dependenciesLease.locks, [
    shared,
    { resourceId: stage.id, generation: 1, mode: 'exclusive' },
  ]);
  assert.deepEqual(original.resource.consumers, [
    { id: `managed-cache:${a.key}:1`, generation: 1, kind: 'copy' },
  ]);
  assert.deepEqual(stage.consumers, [
    { id: `lease:${a.dependencyLeaseId}`, generation: 1, kind: 'unknown' },
  ]);
  assert.deepEqual(
    original.sourceResource.consumers.map((c) => c.id).sort(),
    [a.sourceLeaseId, a.dependencyLeaseId].map((id) => `lease:${id}`).sort(),
  );
  const fence = original.stageFence;
  assert.equal(fence.resourceId, stage.id);
  assert.equal(fence.generation, 1);
  assert.equal(fence.mode, 'maintenance');
  assert.equal(fence.state, 'retry');
  assert.equal(fence.externalPending, true);
  assert.equal(fence.pid, a.pid);
  assert.equal(fence.authorityLeaseId, a.dependencyLeaseId);
  assert.equal(fence.operationId, `cache.input:${stage.id}:1`);
  assert(
    original.outcomes.some(
      (o) =>
        o.resourceId === a.artifactId &&
        o.generation === 1 &&
        o.state === 'retained' &&
        o.reason === 'managed_pnpm_publication_incomplete',
    ),
  );
}
export function immutableArchiveResource(resource: ResourceRecord) {
  const {
    revision: _r,
    updatedAt: _u,
    state: _s,
    consumers: _c,
    lastOutcome: _o,
    ...rest
  } = resource;
  return rest;
}
export function immutableArchiveLease(lease: ResourceLease) {
  const { revision: _r, updatedAt: _u, state: _s, reason: _reason, evidence: _e, ...rest } = lease;
  return rest;
}
export const archiveEqual = (a: unknown, b: unknown, reason: string) => {
  if (!isDeepStrictEqual(a, b)) throw new Error(`cache_archive_${reason}`);
};
