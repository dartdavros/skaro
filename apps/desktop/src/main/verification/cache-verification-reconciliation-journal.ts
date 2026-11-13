import { inspectReplayJournal as inspectJournal } from './cache-verification-reconciliation-replay-inspection';
import type { AppDb, ResourceLease, ResourceLeaseRequest } from '@skaro/core';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import { dirname, resolve } from 'node:path';
import { freezeReconciliation } from './cache-verification-reconciliation-layout';
import {
  readCacheReconciliationPlan,
  type CacheReconciliationPlan,
} from './cache-verification-reconciliation-plan';
import { assertReplayJournal } from './cache-verification-reconciliation-replay-schema';
import {
  replayEqual,
  assertReplayControlRequest,
} from './cache-verification-reconciliation-replay-lease';
import { snapshotReplayPlan as snapshot } from './cache-verification-reconciliation-replay-snapshot';
import { readReplayJournalValue } from './cache-verification-reconciliation-replay-storage';
import { reconciliationRemainder as readRemainder } from './cache-verification-reconciliation-replay-physical';
import {
  reconciliationJournalKey,
  RECONCILIATION_SESSION_LIMIT,
  replayFail as fail,
  type CacheReconciliationJournal,
  type ReconciliationRole,
} from './cache-verification-reconciliation-replay-types';

export type { CacheReconciliationJournal } from './cache-verification-reconciliation-replay-types';
import { reconciliationAttempt } from './cache-verification-reconciliation-identity';
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function loadCacheReconciliationJournal(
  db: AppDb,
  failedIntent?: string,
): CacheReconciliationJournal | undefined {
  const value = readReplayJournalValue(db, failedIntent);
  if (value === undefined) return undefined;
  assertReplayJournal(value);
  if (
    reconciliationJournalKey(reconciliationAttempt(value.original).intentId) !==
    reconciliationJournalKey(failedIntent)
  )
    fail('journal_identity');
  if (
    db.shell.projectScope !== value.project.projectId ||
    resolve(dirname(db.filePath), 'managed-caches-v1') !== value.storeRoot ||
    resolve(dirname(value.storeRoot), 'skaro.db') !== db.filePath
  )
    fail('database_scope');
  return freezeReconciliation(value);
}
function saveJournal(
  db: AppDb,
  before: CacheReconciliationJournal | undefined,
  next: CacheReconciliationJournal,
) {
  assertReplayJournal(next);
  if (
    !db.settings.compareAndSet(
      reconciliationJournalKey(reconciliationAttempt(next.original).intentId),
      before,
      next,
    )
  )
    fail('journal_changed');
  return freezeReconciliation(copy(next));
}

/** Initial creation re-reads the positive original plan; a supplied object/serialized flag is not authority. */
export async function createCacheReconciliationJournal(db: AppDb, plan: CacheReconciliationPlan) {
  if (loadCacheReconciliationJournal(db, plan.attempt.intentId)) fail('journal_already_exists');
  const actual = await readCacheReconciliationPlan(
      db,
      dirname(plan.storeRoot),
      plan.attempt.intentId,
    ),
    expected = snapshot(plan),
    current = snapshot(actual);
  replayEqual(
    { ...expected, createdAt: 0 },
    { ...current, createdAt: 0 },
    'original_positive_plan_changed',
  );
  await actual.requireUnchanged();
  const journal = freezeReconciliation(current);
  assertReplayJournal(journal);
  await inspectJournal(db, dirname(journal.storeRoot), journal);
  return saveJournal(db, undefined, journal);
}

export async function validateCacheReconciliationJournal(
  db: AppDb,
  data: string,
  journal: CacheReconciliationJournal,
  controllerId?: string,
): Promise<void> {
  replayEqual(
    loadCacheReconciliationJournal(db, reconciliationAttempt(journal.original).intentId),
    journal,
    'journal_changed',
  );
  await inspectJournal(db, data, journal, controllerId);
  replayEqual(
    loadCacheReconciliationJournal(db, reconciliationAttempt(journal.original).intentId),
    journal,
    'journal_changed',
  );
}

/** Close acquire-to-record crash gaps. This is an exact request receipt, never a granted capability. */
export async function prepareReconciliationSession(
  db: AppDb,
  journal: CacheReconciliationJournal,
  request: ResourceLeaseRequest,
): Promise<CacheReconciliationJournal> {
  await validateCacheReconciliationJournal(db, dirname(journal.storeRoot), journal);
  assertReplayControlRequest(
    request,
    journal.original.sourceResource,
    reconciliationAttempt(journal.original).intentId,
  );
  if (
    journal.state !== 'pending' ||
    journal.preparations.length >= RECONCILIATION_SESSION_LIMIT ||
    journal.preparations.some((item) => item.request.id === request.id) ||
    db.admission.all().some((lease) => lease.id === request.id)
  )
    fail('preparation_not_fresh');
  const birth = await processBirth(process.pid);
  if (!birth) fail('native_session_identity_unavailable');
  const next = freezeReconciliation(
    copy({
      ...journal,
      preparations: [
        ...journal.preparations,
        {
          request,
          pid: process.pid,
          birth: birth!,
          recordedAt: Date.now(),
        },
      ],
    }),
  );
  return saveJournal(db, journal, next);
}

/** Persist native parent identity BEFORE any cleanup claim/effect; the record cannot authorize a grant. */
export async function recordReconciliationSession(
  db: AppDb,
  journal: CacheReconciliationJournal,
  controller: ResourceLease,
): Promise<CacheReconciliationJournal> {
  replayEqual(
    loadCacheReconciliationJournal(db, reconciliationAttempt(journal.original).intentId),
    journal,
    'journal_changed',
  );
  if (
    journal.state !== 'pending' ||
    journal.sessions.length >= RECONCILIATION_SESSION_LIMIT ||
    journal.sessions.some((session) => session.controller.id === controller.id)
  )
    fail('session_not_fresh');
  const birth = await processBirth(process.pid);
  if (!birth) fail('native_session_identity_unavailable');
  const next = freezeReconciliation(
    copy({
      ...journal,
      sessions: [
        ...journal.sessions,
        {
          controller,
          pid: process.pid,
          birth: birth!,
          recordedAt: Date.now(),
        },
      ],
    }),
  );
  await inspectJournal(db, dirname(journal.storeRoot), next, controller.id);
  return saveJournal(db, journal, next);
}

export async function reconciliationRemainder(
  journal: CacheReconciliationJournal,
  role: ReconciliationRole,
) {
  assertReplayJournal(journal);
  if (!['artifact', 'scratch', 'stage'].includes(role)) fail('unknown_tree_role');
  return readRemainder(journal, role);
}

export async function completeJournal(
  db: AppDb,
  journal: CacheReconciliationJournal,
): Promise<CacheReconciliationJournal> {
  replayEqual(
    loadCacheReconciliationJournal(db, reconciliationAttempt(journal.original).intentId),
    journal,
    'journal_changed',
  );
  const controllers = journal.sessions.filter(
    (session) =>
      session.pid === process.pid &&
      db.admission
        .all()
        .some((lease) => lease.id === session.controller.id && lease.state === 'granted'),
  );
  if (controllers.length !== 1) fail('completion_requires_live_controller');
  const status = await inspectJournal(
    db,
    dirname(journal.storeRoot),
    journal,
    controllers[0]!.controller.id,
  );
  if (!status.settled || !status.originalsReleased || !status.metadataAbsent)
    fail('completion_before_settlement');
  return saveJournal(
    db,
    journal,
    freezeReconciliation(copy({ ...journal, state: 'complete' as const })),
  );
}
