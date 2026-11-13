import {
  ownsResourceCapacity,
  type AppDb,
  type ResourceLease,
  type ResourceRecord,
} from '@skaro/core';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import { isDeepStrictEqual } from 'node:util';
import { ManagedCacheStore } from '../managed-cache-store';
import { cacheProcessAbsent } from '../managed-cache-metadata';
import { reconciliationAttempt } from './cache-verification-reconciliation-identity';
import { preservedReconciliationDatabase } from './cache-verification-reconciliation-preserved';
import {
  assertReplayController,
  assertReplayNeverGrantedPreparation,
  assertReplayCompletedControllerTerminal,
  assertReplayCompletedPreparedTerminal,
  replayLeaseRequest,
  replayEqual,
} from './cache-verification-reconciliation-replay-lease';
import { readReplayFences } from './cache-verification-reconciliation-replay-fences';
import {
  reconciliationJournalKey,
  replayFail as fail,
  type CacheReconciliationJournal,
} from './cache-verification-reconciliation-replay-types';

const immutableLease = (lease: ResourceLease) => {
  const {
    revision: _revision,
    updatedAt: _updated,
    state: _state,
    reason: _reason,
    evidence: _evidence,
    ...rest
  } = lease;
  return rest;
};
const immutableResource = (resource: ResourceRecord) => {
  const {
    revision: _revision,
    updatedAt: _updated,
    state: _state,
    consumers: _consumers,
    lastOutcome: _outcome,
    ...rest
  } = resource;
  return rest;
};
export function readReplayDatabase(db: AppDb, data: string, journal: CacheReconciliationJournal) {
  const attempt = reconciliationAttempt(journal.original);
  const store = new ManagedCacheStore(db, data),
    ids = new Set<string>([attempt.artifactId, attempt.stageId, attempt.sourceId]);
  const leases = db.admission
    .all()
    .filter(
      (lease) =>
        lease.projectId === journal.project.projectId ||
        lease.locks.some((lock) => ids.has(lock.resourceId)),
    );
  if (leases.length > 10000) fail('lease_limit');
  const preparedIds = new Set(journal.preparations.map((item) => `lease:${item.request.id}`));
  const resources = db.resources.list();
  if (resources.length > 10000) fail('resource_limit');
  const entries = store
    .artifacts()
    .filter((entry) => entry.projectId === journal.project.projectId);
  return {
    resourceCount: resources.filter((resource) => resource.projectId === journal.project.projectId)
      .length,
    entryCount: entries.length,
    preserved:
      journal.version === 2
        ? preservedReconciliationDatabase(
            db,
            entries,
            journal.original,
            journal.preparations.map((item) => item.request.id),
            reconciliationJournalKey(attempt.intentId),
          )
        : undefined,
    preparedConsumers: resources.flatMap((resource) =>
      resource.consumers
        .filter((consumer) => preparedIds.has(consumer.id))
        .map((consumer) => ({ resourceId: resource.id, ...consumer })),
    ),
    entries: entries.filter((entry) => entry.key === attempt.key),
    builders: store.builders().filter((entry) => entry.projectId === journal.project.projectId),
    resources: db.resources
      .list(journal.project.projectId)
      .filter((resource) => ids.has(resource.id)),
    leases,
    outcomes: db.resources.outcomes(attempt.artifactId, 1000),
    fences: readReplayFences(db, journal),
  };
}
export type ReplayDatabase = ReturnType<typeof readReplayDatabase>;
export type ReplayAbsence = { artifact: boolean; scratch: boolean; stage: boolean };

function assertNoControllerHoldings(current: ReplayDatabase, lease: ResourceLease, pid: number) {
  if (
    ownsResourceCapacity(lease) ||
    current.preparedConsumers.some((consumer) => consumer.id === `lease:${lease.id}`) ||
    current.fences.rows.some((row) => {
      const fence = JSON.parse(row.value) as { pid?: unknown; authorityLeaseId?: unknown };
      return fence.pid === pid || fence.authorityLeaseId === lease.id;
    })
  )
    fail('settled_or_never_granted_preparation_has_effects');
}

/** Domain receipts + exact retained reservations remain mandatory; native absence is additional only. */
export async function assertReplayAuthority(
  journal: CacheReconciliationJournal,
  current: ReplayDatabase,
  absent: ReplayAbsence,
  controllerId?: string,
) {
  const original = journal.original;
  const attempt = reconciliationAttempt(original);
  if (journal.preserved) {
    const { proofs: _proofs, ...preserved } = journal.preserved;
    replayEqual(current.preserved, preserved, 'preserved_state_changed');
  } else if (current.resourceCount !== 3 || current.entryCount !== current.entries.length)
    fail('historical_resource_set');
  if (current.builders.length || current.resources.length !== 3) fail('resource_set');
  const resource = current.resources.find((r) => r.id === attempt.artifactId),
    stage = current.resources.find((r) => r.id === attempt.stageId),
    source = current.resources.find((r) => r.id === attempt.sourceId);
  if (!resource || !stage || !source) fail('resource_missing');
  for (const [actual, before] of [
    [resource!, original.resource],
    [stage!, original.stageResource],
    [source!, original.sourceResource],
  ] as const) {
    replayEqual(
      immutableResource(actual),
      immutableResource(before as ResourceRecord),
      'resource_binding_changed',
    );
    if (actual.revision < before.revision || actual.updatedAt < before.updatedAt)
      fail('resource_revision');
  }
  for (const [actual, before, gone] of [
    [resource!, original.resource, absent.artifact && absent.scratch],
    [stage!, original.stageResource, absent.stage],
  ] as const) {
    if (!['available', 'released'].includes(actual.state)) fail('resource_state');
    if (actual.state === 'released') {
      if (!gone || actual.consumers.length) fail('released_tree_or_consumer_present');
    } else replayEqual(actual.consumers, before.consumers, 'resource_consumer_changed');
  }
  if (source!.state !== 'available') fail('source_not_persistent_available');
  const physicalAbsent = absent.artifact && absent.scratch && absent.stage,
    resourcesReleased = resource!.state === 'released' && stage!.state === 'released',
    settled =
      physicalAbsent && resourcesReleased && !current.fences.artifact && !current.fences.stage;
  if (!current.fences.stage && !absent.stage) fail('original_stage_fence_lost');
  const known = new Set([
    attempt.sourceLeaseId,
    attempt.dependenciesLeaseId,
    ...journal.preparations.map((preparation) => preparation.request.id),
  ]);
  for (const lease of current.leases) {
    if (
      !known.has(lease.id) &&
      (!['released', 'cancelled', 'stopped_by_owner'].includes(lease.state) ||
        lease.createdAt >= journal.createdAt)
    )
      fail('unknown_relevant_actor');
  }
  const originals = [original.sourceLease, original.dependenciesLease].map((before) => {
    const lease = current.leases.find((lease) => lease.id === before.id);
    if (!lease) fail('original_lease_missing');
    if (lease!.state === 'retained') replayEqual(lease, before, 'retained_lease_changed');
    else {
      if (
        lease!.state !== 'released' ||
        !settled ||
        lease!.revision <= before.revision ||
        lease!.updatedAt < before.updatedAt
      )
        fail('old_reservation_released_early');
      replayEqual(
        immutableLease(lease!),
        immutableLease(before as ResourceLease),
        'released_original_lease_changed',
      );
    }
    return lease!;
  });
  const originalsReleased = originals.every((lease) => lease.state === 'released');
  const completedSettlement =
    journal.state === 'complete' && settled && originalsReleased && !current.entries.length;
  if (controllerId && !journal.sessions.some((session) => session.controller.id === controllerId))
    fail('unrecorded_current_controller');
  for (const preparation of journal.preparations) {
    const lease = current.leases.find((lease) => lease.id === preparation.request.id);
    const session = journal.sessions.find((item) => item.controller.id === preparation.request.id);
    if (lease) {
      if (lease.state === 'stopped_by_owner' && session && completedSettlement) {
        // A recorded controller can reach stopped_by_owner only after confirmed teardown.
        // Unlike an unadmitted waiter, this exception needs fully derived COMPLETE settlement.
        assertReplayCompletedControllerTerminal(lease, journal);
        assertNoControllerHoldings(current, lease, preparation.pid);
      } else if (
        lease.state === 'stopped_by_owner' &&
        !session &&
        completedSettlement &&
        lease.reason === 'teardown_confirmed'
      ) {
        assertReplayCompletedPreparedTerminal(lease, journal);
        assertNoControllerHoldings(current, lease, preparation.pid);
      } else if (
        ['waiting_resource', 'waiting_quota', 'cancelled', 'stopped_by_owner'].includes(lease.state)
      ) {
        assertReplayNeverGrantedPreparation(lease, journal);
        if (session) fail('never_granted_preparation_has_session');
        assertNoControllerHoldings(current, lease, preparation.pid);
      } else assertReplayController(lease, journal);
      replayEqual(replayLeaseRequest(lease), preparation.request, 'prepared_actor_changed');
      if (lease.createdAt < preparation.recordedAt) fail('prepared_actor_not_fresh');
    }
    if (
      !session &&
      (!cacheProcessAbsent(preparation.pid) || (await processBirth(preparation.pid)) !== undefined)
    )
      fail('unrecorded_prepared_actor_not_closed');
  }
  for (const session of journal.sessions) {
    const lease = current.leases.find((lease) => lease.id === session.controller.id);
    if (!lease) fail('controller_lease_missing');
    if (lease!.state === 'stopped_by_owner' && completedSettlement)
      assertReplayCompletedControllerTerminal(lease!, journal);
    else assertReplayController(lease!, journal);
    replayEqual(
      immutableLease(lease!),
      immutableLease(session.controller as ResourceLease),
      'controller_snapshot_changed',
    );
    if (
      lease!.revision < session.controller.revision ||
      lease!.updatedAt < session.controller.updatedAt
    )
      fail('controller_revision');
    if (lease!.id === controllerId) {
      if (
        lease!.state !== 'granted' ||
        session.pid !== process.pid ||
        (await processBirth(session.pid)) !== session.birth
      )
        fail('fresh_live_local_controller_required');
      replayEqual(lease, session.controller, 'current_controller_changed');
    } else if (
      (!['granted', 'retained', 'released'].includes(lease!.state) &&
        !(completedSettlement && lease!.state === 'stopped_by_owner')) ||
      !cacheProcessAbsent(session.pid) ||
      (await processBirth(session.pid)) !== undefined
    )
      fail('old_controller_not_closed');
  }
  const expectedSource = [
    ...originals,
    ...journal.preparations.flatMap((preparation) => {
      const lease = current.leases.find((lease) => lease.id === preparation.request.id);
      return lease ? [lease] : [];
    }),
  ]
    .filter((lease) => lease.state === 'retained' || lease.state === 'granted')
    .map((lease) => ({
      id: `lease:${lease.id}`,
      generation: attempt.sourceGeneration,
      kind: 'unknown' as const,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  replayEqual(source!.consumers, expectedSource, 'source_consumers_changed');
  const originalReceipt = original.outcomes[0]!;
  if (!current.outcomes.some((outcome) => isDeepStrictEqual(outcome, originalReceipt)))
    fail('original_closed_producer_domain_receipt_missing');
  if (current.entries.length === 1)
    replayEqual(current.entries[0], original.entry, 'publication_metadata_changed');
  else if (current.entries.length || !settled || !originalsReleased)
    fail('publication_metadata_removed_early');
  if (journal.state === 'complete' && (!settled || !originalsReleased || current.entries.length))
    fail('completion_not_settled');
  return { settled, originalsReleased, metadataAbsent: current.entries.length === 0 };
}
