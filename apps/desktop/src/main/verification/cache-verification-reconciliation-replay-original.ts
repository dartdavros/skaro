import {
  resourceId,
  resourceRegistration,
  resourceOutcome,
  type ResourceLease,
  type ResourceRecord,
} from '@skaro/core';
import { join } from 'node:path';
import { artifactMetadata } from '../managed-cache-metadata';
import { validReconciliationPublicationShape } from './cache-verification-reconciliation-unique';
import { assertInitializedReconciliationOriginal } from './cache-verification-reconciliation-initialized-evidence';
import { CACHE_VERIFICATION_OWNER_SCOPE as scope } from './cache-verification-scope';
import {
  CACHE_RECONCILIATION_ATTEMPT as legacyAttempt,
  assertReconciliationResourceBinding,
} from './cache-verification-reconciliation-layout';
import {
  reconciliationAttempt,
  sourceReconciliationLock,
  requireReconciliationIntent,
} from './cache-verification-reconciliation-identity';
import { replayEqual, assertReplayLease } from './cache-verification-reconciliation-replay-lease';
import {
  replayFail as fail,
  replayKeys,
  replayInteger,
  replayHash,
  type CacheReconciliationJournal,
} from './cache-verification-reconciliation-replay-types';

function assertOriginalResource(resource: ResourceRecord) {
  replayKeys(resource, [
    'id',
    'revision',
    'createdAt',
    'updatedAt',
    'lastOutcome',
    'projectId',
    'kind',
    'identity',
    'owner',
    'purpose',
    'ownership',
    'preservation',
    'generation',
    'consumers',
    'state',
    'objectIds',
    'source',
  ]);
  const { id, revision, createdAt, updatedAt, lastOutcome: _outcome, ...registration } = resource;
  replayEqual(resourceRegistration(registration), registration, 'resource_registration');
  if (resourceId(registration) !== id) fail('resource_id');
  replayInteger(revision, 1);
  replayInteger(createdAt);
  replayInteger(updatedAt);
  if (updatedAt < createdAt) fail('resource_times');
}
/** Static receipt validation, never a native-process closure proof or cleanup grant. */
export function assertReplayOriginal(
  journal: Pick<
    CacheReconciliationJournal,
    'version' | 'createdAt' | 'storeRoot' | 'project' | 'original'
  >,
) {
  replayKeys(journal.original, [
    'entry',
    'resource',
    'stageResource',
    'sourceResource',
    'sourceLease',
    'dependenciesLease',
    'stageFence',
    'outcomes',
  ]);
  const original = journal.original;
  artifactMetadata([original.entry]);
  assertInitializedReconciliationOriginal(original);
  for (const resource of [original.resource, original.stageResource, original.sourceResource])
    assertOriginalResource(resource as ResourceRecord);
  const a = reconciliationAttempt(original);
  requireReconciliationIntent(a.intentId);
  requireReconciliationIntent(a.inputDirectory);
  replayHash(a.key);
  replayHash(a.inputVersion);
  replayInteger(a.pid, 1);
  if (
    !a.birth ||
    original.entry.manager !== 'pnpm' ||
    !validReconciliationPublicationShape(original.entry, journal.version, journal.storeRoot) ||
    original.entry.state !== 'retained' ||
    original.entry.immutable !== false ||
    original.entry.bytes <= 0 ||
    original.entry.digest !== undefined ||
    original.entry.resourceId !== a.artifactId ||
    original.entry.generation !== a.artifactGeneration
  )
    fail('original_publication');
  if (journal.version === 1) {
    replayEqual(
      Object.fromEntries(Object.keys(legacyAttempt).map((key) => [key, a[key as keyof typeof a]])),
      legacyAttempt,
      'historical_attempt_identity',
    );
    replayEqual(
      { ...original.entry, usedAt: 0 },
      {
        manager: 'pnpm',
        key: a.key,
        projectId: scope.projectId,
        resourceId: a.artifactId,
        generation: 1,
        state: 'retained',
        bytes: 23546313,
        usedAt: 0,
        immutable: false,
        expandedBytes: 247215,
        expandedFiles: 887,
        consumer: { intent: a.intentId, pid: a.pid, birth: a.birth },
      },
      'historical_publication',
    );
  }
  assertReconciliationResourceBinding(
    original.resource as ResourceRecord,
    join(journal.storeRoot, 'dependencies', a.key),
    {
      recovery: 'skaro:pnpm-10.11-public-sha512-store-v10-v1',
      dataVersion: a.key,
    },
  );
  assertReconciliationResourceBinding(
    original.stageResource as ResourceRecord,
    join(journal.storeRoot, 'verification-inputs', a.inputDirectory),
    {
      recovery: 'skaro:verified-original-pnpm-input-v1',
      dataVersion: a.inputVersion,
    },
  );
  replayHash(original.sourceResource.source?.dataVersion);
  assertReconciliationResourceBinding(
    original.sourceResource as ResourceRecord,
    journal.project.root,
    {
      recovery: 'skaro:registered-project-root-read-v1',
      dataVersion: original.sourceResource.source!.dataVersion,
    },
    true,
  );
  replayEqual(
    original.resource.consumers,
    [
      {
        id: `managed-cache:${a.key}:${a.artifactGeneration}`,
        generation: a.artifactGeneration,
        kind: 'copy',
      },
    ],
    'original_artifact_consumer',
  );
  replayEqual(
    original.stageResource.consumers,
    [{ id: `lease:${a.dependenciesLeaseId}`, generation: a.stageGeneration, kind: 'unknown' }],
    'original_stage_consumer',
  );
  replayEqual(
    original.sourceResource.consumers,
    [a.sourceLeaseId, a.dependenciesLeaseId]
      .sort()
      .map((id) => ({ id: `lease:${id}`, generation: a.sourceGeneration, kind: 'unknown' })),
    'original_source_consumers',
  );
  for (const source of [true, false]) {
    const lease = source ? original.sourceLease : original.dependenciesLease;
    assertReplayLease(lease as ResourceLease);
    if (
      lease.projectId !== scope.projectId ||
      lease.intentId !== a.intentId ||
      lease.state !== 'retained' ||
      lease.ownerId !== (source ? 'cache-verification:source' : 'managed-cache:dependencies') ||
      lease.checkpoint !==
        (source ? 'cache-verification-real-source' : 'managed-cache-dependencies') ||
      lease.reason !== 'external_state_requires_reconciliation' ||
      lease.account !== undefined ||
      lease.cost.ramBytes <= 0 ||
      lease.cost.model ||
      lease.cost.environment ||
      lease.cost.review ||
      lease.cost.build !== (source ? 0 : 1) ||
      lease.updatedAt > journal.createdAt
    )
      fail('original_lease');
    replayEqual(
      lease.locks,
      [
        sourceReconciliationLock(original.sourceResource),
        ...(source
          ? []
          : [{ resourceId: a.stageId, generation: a.stageGeneration, mode: 'exclusive' }]),
      ],
      'original_lease_locks',
    );
  }
  if (!Array.isArray(original.outcomes) || original.outcomes.length !== 1) fail('original_outcome');
  const outcome = original.outcomes[0]!;
  replayKeys(outcome, [
    'operationId',
    'resourceId',
    'generation',
    'action',
    'state',
    'reason',
    'at',
    'relatedIds',
    'freedBytes',
  ]);
  const { at, ...input } = outcome;
  resourceOutcome(input);
  replayInteger(at);
  if (
    outcome.resourceId !== a.artifactId ||
    outcome.generation !== a.artifactGeneration ||
    outcome.action !== 'inspect' ||
    outcome.state !== 'retained' ||
    outcome.reason !== 'managed_pnpm_publication_incomplete'
  )
    fail('producer_receipt');
  replayEqual(original.resource.lastOutcome, outcome, 'original_last_outcome');
  if (original.stageResource.lastOutcome || original.sourceResource.lastOutcome)
    fail('original_other_outcome');
  const fence = original.stageFence;
  replayKeys(fence, [
    'resourceId',
    'generation',
    'operationId',
    'mode',
    'token',
    'owner',
    'pid',
    'identity',
    'objectIds',
    'signature',
    'externalPending',
    'authorityLeaseId',
    'state',
  ]);
  if (
    fence.resourceId !== a.stageId ||
    fence.generation !== a.stageGeneration ||
    fence.mode !== 'maintenance' ||
    fence.state !== 'retry' ||
    fence.pid !== a.pid ||
    fence.externalPending !== true ||
    fence.authorityLeaseId !== a.dependenciesLeaseId ||
    fence.operationId !== `cache.input:${a.stageId}:${a.stageGeneration}` ||
    typeof fence.token !== 'string' ||
    !fence.token ||
    typeof fence.owner !== 'string' ||
    !fence.owner
  )
    fail('original_stage_fence');
  replayEqual(fence.identity, original.stageResource.identity, 'original_fence_identity');
  replayEqual(fence.objectIds, [], 'original_fence_objects');
  const r = original.stageResource;
  replayEqual(
    fence.signature,
    JSON.stringify([
      r.projectId,
      r.kind,
      r.identity,
      r.owner,
      r.purpose,
      r.ownership,
      r.preservation,
      r.source,
    ]),
    'original_fence_signature',
  );
}
