import {
  validateResourceRequest,
  type ResourceLease,
  type ResourceLeaseRequest,
} from '@skaro/core';
import { isDeepStrictEqual } from 'node:util';
import { CACHE_VERIFICATION_OWNER_SCOPE as scope } from './cache-verification-scope';
import { CACHE_RECONCILIATION_ATTEMPT as attempt } from './cache-verification-reconciliation-layout';
import {
  reconciliationAttempt,
  sourceReconciliationLock,
} from './cache-verification-reconciliation-identity';
import {
  replayFail as fail,
  replayKeys,
  replayInteger,
  type CacheReconciliationJournal,
} from './cache-verification-reconciliation-replay-types';

export const replayEqual = (a: unknown, b: unknown, reason: string) => {
  if (!isDeepStrictEqual(a, b)) fail(reason);
};
export const originalRootLock = {
  resourceId: attempt.sourceId,
  generation: 1,
  mode: 'shared' as const,
};
export function replayLeaseRequest(lease: ResourceLease): ResourceLeaseRequest {
  const {
    revision: _revision,
    sequence: _sequence,
    createdAt: _created,
    updatedAt: _updated,
    state: _state,
    reason: _reason,
    evidence: _evidence,
    ...request
  } = lease;
  return request;
}
export function assertReplayControlRequest(
  request: ResourceLeaseRequest,
  source = { id: attempt.sourceId as string, generation: 1 },
  failedIntent: string = attempt.intentId,
) {
  replayKeys(request, [
    'id',
    'projectId',
    'ownerId',
    'intentId',
    'checkpoint',
    'account',
    'cost',
    'locks',
  ]);
  validateResourceRequest(request);
  replayKeys(request.cost, [
    'ramBytes',
    'cpuMillis',
    'model',
    'environment',
    'build',
    'review',
    'diskBytes',
    'pools',
  ]);
  for (const lock of request.locks) replayKeys(lock, ['resourceId', 'generation', 'mode']);
  if (
    request.projectId !== scope.projectId ||
    request.ownerId !== 'managed-cache:reconciliation' ||
    request.checkpoint !== 'cache-reconciliation' ||
    request.intentId === failedIntent ||
    request.account !== undefined ||
    request.cost.ramBytes <= 0 ||
    request.cost.model ||
    request.cost.environment ||
    request.cost.build ||
    request.cost.review
  )
    fail('controller_binding');
  replayEqual(request.locks, [sourceReconciliationLock(source)], 'controller_locks');
}
function assertReplayLeaseMetadata(lease: ResourceLease) {
  replayKeys(lease, [
    'id',
    'projectId',
    'ownerId',
    'intentId',
    'checkpoint',
    'account',
    'cost',
    'locks',
    'revision',
    'sequence',
    'state',
    'reason',
    'createdAt',
    'updatedAt',
    'evidence',
  ]);
  validateResourceRequest(lease);
  replayKeys(lease.cost, [
    'ramBytes',
    'cpuMillis',
    'model',
    'environment',
    'build',
    'review',
    'diskBytes',
    'pools',
  ]);
  for (const lock of lease.locks) replayKeys(lock, ['resourceId', 'generation', 'mode']);
  for (const value of [lease.revision, lease.sequence]) replayInteger(value, 1);
  replayInteger(lease.createdAt);
  replayInteger(lease.updatedAt);
  if (
    lease.updatedAt < lease.createdAt ||
    typeof lease.reason !== 'string' ||
    !lease.reason.trim() ||
    ![
      'waiting_resource',
      'waiting_quota',
      'granted',
      'retained',
      'released',
      'cancelled',
      'stopped_by_owner',
    ].includes(lease.state) ||
    (lease.evidence !== undefined && typeof lease.evidence !== 'string')
  )
    fail('lease_schema');
}
export function assertReplayLease(lease: ResourceLease) {
  assertReplayLeaseMetadata(lease);
  if (!['granted', 'retained', 'released'].includes(lease.state)) fail('lease_schema');
}

/** Pure admission-state classification only, never a closed-executor receipt or cleanup approval. */
export function neverGrantedReconciliationAdmission(
  lease: Pick<ResourceLease, 'state' | 'reason' | 'evidence'>,
): boolean {
  return (
    lease.evidence === undefined &&
    typeof lease.reason === 'string' &&
    !!lease.reason.trim() &&
    (lease.state === 'waiting_resource' ||
      lease.state === 'waiting_quota' ||
      lease.state === 'cancelled' ||
      (lease.state === 'stopped_by_owner' && lease.reason === 'stopped_by_owner'))
  );
}
function assertReplayControlFreshness(lease: ResourceLease, journal: CacheReconciliationJournal) {
  assertReplayControlRequest(
    replayLeaseRequest(lease),
    journal.original.sourceResource,
    reconciliationAttempt(journal.original).intentId,
  );
  if (
    lease.createdAt < journal.createdAt ||
    lease.sequence <=
      Math.max(journal.original.sourceLease.sequence, journal.original.dependenciesLease.sequence)
  )
    fail('controller_freshness');
}
export function assertReplayController(lease: ResourceLease, journal: CacheReconciliationJournal) {
  assertReplayLease(lease);
  assertReplayControlFreshness(lease, journal);
}
export function assertReplayNeverGrantedPreparation(
  lease: ResourceLease,
  journal: CacheReconciliationJournal,
) {
  assertReplayLeaseMetadata(lease);
  assertReplayControlFreshness(lease, journal);
  const waiting = lease.state === 'waiting_resource' || lease.state === 'waiting_quota';
  if (!neverGrantedReconciliationAdmission(lease) || (!waiting && lease.revision < 2))
    fail('never_granted_preparation_required');
}

export const COMPLETED_RECONCILIATION_CONTROL_EVIDENCE =
  'completed_public_downloads_recovery_control_accounting_settled';

/** Pure terminal metadata only. This neither proves native absence nor authorizes any effect. */
export function completedPreparedReconciliationTerminal(
  lease: Pick<ResourceLease, 'state' | 'reason' | 'evidence' | 'revision'>,
): boolean {
  return (
    lease.state === 'stopped_by_owner' &&
    lease.reason === 'teardown_confirmed' &&
    lease.evidence === COMPLETED_RECONCILIATION_CONTROL_EVIDENCE &&
    Number.isSafeInteger(lease.revision) &&
    lease.revision >= 4
  );
}

/** Metadata check only: the authority module MUST independently derive complete physical settlement. */
export function assertReplayCompletedControllerTerminal(
  lease: ResourceLease,
  journal: CacheReconciliationJournal,
) {
  assertReplayLeaseMetadata(lease);
  assertReplayControlFreshness(lease, journal);
  const session = journal.sessions.find((item) => item.controller.id === lease.id);
  if (
    journal.state !== 'complete' ||
    !session ||
    lease.revision <= session.controller.revision ||
    lease.updatedAt < session.controller.updatedAt ||
    lease.state !== 'stopped_by_owner' ||
    lease.reason !== 'teardown_confirmed' ||
    typeof lease.evidence !== 'string' ||
    !lease.evidence.trim()
  )
    fail('completed_controller_teardown_required');
}

/** Prepared-only accounting settlement; the outer authority still checks complete absence/isolation. */
export function assertReplayCompletedPreparedTerminal(
  lease: ResourceLease,
  journal: CacheReconciliationJournal,
) {
  assertReplayLeaseMetadata(lease);
  assertReplayControlFreshness(lease, journal);
  const preparation = journal.preparations.find((item) => item.request.id === lease.id);
  if (
    journal.state !== 'complete' ||
    !preparation ||
    journal.sessions.some((item) => item.controller.id === lease.id) ||
    lease.createdAt < preparation.recordedAt ||
    !completedPreparedReconciliationTerminal(lease)
  )
    fail('completed_prepared_teardown_required');
  // At least four revisions: original waiting request -> grant -> retained stop -> confirmed release.
  replayEqual(
    replayLeaseRequest(lease),
    preparation!.request,
    'completed_prepared_request_changed',
  );
}
