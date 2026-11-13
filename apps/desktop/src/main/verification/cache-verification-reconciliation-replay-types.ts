import type { ResourceLease, ResourceLeaseRequest } from '@skaro/core';
import type { CacheReconciliationPlan } from './cache-verification-reconciliation-plan';
import type { ReadonlyReconciliation } from './cache-verification-reconciliation-layout';
import { CACHE_RECONCILIATION_ATTEMPT } from './cache-verification-reconciliation-layout';
import { requireReconciliationIntent } from './cache-verification-reconciliation-identity';
import type { ReconciliationProofReceipt } from './cache-verification-reconciliation-producer-proof';
import type { ReconciliationPreserved } from './cache-verification-reconciliation-preserved';
import type { ReconciliationAccounting } from './cache-verification-reconciliation-accounting';
import type { UniqueReconciliationAccounting } from './cache-verification-reconciliation-unique-accounting';
import { CACHE_VERIFICATION_OWNER_SCOPE as scope } from './cache-verification-scope';

export const RECONCILIATION_JOURNAL_KEY =
  'resources.cache-reconciliation.82482632e50f0f8f43a01b9bc412d538a89fbbfd8f8f0f0c5a9d9d81284bc6a5.v1';
export function reconciliationJournalKey(
  failedIntent: string = CACHE_RECONCILIATION_ATTEMPT.intentId,
) {
  requireReconciliationIntent(failedIntent);
  return failedIntent === CACHE_RECONCILIATION_ATTEMPT.intentId
    ? RECONCILIATION_JOURNAL_KEY
    : `resources.cache-reconciliation.${scope.projectId}.${failedIntent}.v2`;
}
export const RECONCILIATION_JOURNAL_BYTE_LIMIT = 8 * 1024 ** 2;
export const RECONCILIATION_JOURNAL_NODE_LIMIT = 20000;
export const RECONCILIATION_SESSION_LIMIT = 32;
export type ReconciliationRole = 'artifact' | 'scratch' | 'stage';
export type ReconciliationTree = CacheReconciliationPlan['trees']['artifact'];
export interface ReconciliationPreparation {
  request: ResourceLeaseRequest;
  pid: number;
  birth: string;
  recordedAt: number;
}
export interface ReconciliationSession {
  controller: ResourceLease;
  pid: number;
  birth: string;
  recordedAt: number;
}
export interface ReconciliationJournalData {
  version: 1 | 2;
  producerProof?: ReconciliationProofReceipt;
  preserved?: ReadonlyReconciliation<ReconciliationPreserved>;
  state: 'pending' | 'complete';
  createdAt: number;
  storeRoot: string;
  project: Pick<CacheReconciliationPlan['project'], 'projectId' | 'root' | 'head'>;
  original: Pick<
    CacheReconciliationPlan,
    | 'entry'
    | 'resource'
    | 'stageResource'
    | 'sourceResource'
    | 'sourceLease'
    | 'dependenciesLease'
    | 'stageFence'
    | 'outcomes'
  >;
  trees: Record<ReconciliationRole, ReconciliationTree>;
  evidence: { accounting?: ReconciliationAccounting | UniqueReconciliationAccounting } & Pick<
    CacheReconciliationPlan['trees'],
    | 'phase'
    | 'originalInputVersion'
    | 'downloadedTarballs'
    | 'journaledBytes'
    | 'physicalBytes'
    | 'unjournaledDownloadBytes'
  >;
  preparations: ReconciliationPreparation[];
  sessions: ReconciliationSession[];
  snapshotDigest: string;
}
export type CacheReconciliationJournal = ReadonlyReconciliation<ReconciliationJournalData>;
export const replayFail = (reason: string): never => {
  throw new Error(`cache_reconciliation_replay_${reason}`);
};
export function replayKeys(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    replayFail('schema');
  return value as Record<string, unknown>;
}
export function replayInteger(value: unknown, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) replayFail('schema_integer');
}
export function replayHash(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) replayFail('schema_digest');
}
