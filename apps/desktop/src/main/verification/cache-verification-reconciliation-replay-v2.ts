import {
  resourceId,
  resourceRegistration,
  validateResourceRequest,
  type ResourceLease,
} from '@skaro/core';
import { dirname, join, basename } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { validReconciliationAccountingSeam } from './cache-verification-reconciliation-accounting';
import {
  uniqueReconciliationEntry,
  RECONCILIATION_UNIQUE_METHOD,
  RECONCILIATION_UNIQUE_PHASE,
} from './cache-verification-reconciliation-unique';
import { assertUniqueReconciliationEvidence } from './cache-verification-reconciliation-unique-evidence';
import {
  initializedReconciliationCandidate,
  initializedReconciliationPhaseCandidate,
} from './cache-verification-reconciliation-initialized';
import { assertInitializedReconciliationEvidence } from './cache-verification-reconciliation-initialized-evidence';
import { NPM_INSTALL_BYTE_LIMIT, NPM_INSTALL_FILE_LIMIT } from '../managed-npm-archive';
import { replayLeaseRequest } from './cache-verification-reconciliation-replay-lease';
import {
  reconciliationAttempt,
  requireReconciliationIntent,
} from './cache-verification-reconciliation-identity';
import {
  replayFail as fail,
  replayKeys,
  replayHash,
  replayInteger,
  type CacheReconciliationJournal,
} from './cache-verification-reconciliation-replay-types';

export function assertReconciliationV2Evidence(journal: CacheReconciliationJournal) {
  if (journal.version === 1) {
    if (journal.preserved || journal.producerProof || journal.evidence.accounting)
      fail('historical_journal_shape');
    return;
  }
  const a = reconciliationAttempt(journal.original),
    data = dirname(journal.storeRoot);
  const proof = journal.producerProof,
    preserved = journal.preserved,
    accounting = journal.evidence.accounting;
  if (!proof || !preserved || !accounting) return fail('current_failure_evidence_missing');
  replayKeys(proof, ['path', 'bytes', 'digest']);
  replayHash(proof.digest);
  replayInteger(proof.bytes, 1);
  if (
    proof.path !== join(data, 'verification', `cache-workflow-${a.intentId}`, 'proof.json') ||
    proof.bytes > 2 * 1024 ** 2
  )
    fail('producer_proof_scope');
  replayKeys(preserved, ['resources', 'leases', 'entries', 'outcomes', 'journals', 'proofs']);
  for (const values of [
    preserved.resources,
    preserved.leases,
    preserved.entries,
    preserved.outcomes,
    preserved.journals,
    preserved.proofs,
  ])
    if (!Array.isArray(values) || values.length > 10000) fail('preserved_nodes');
  if (preserved.journals.length > 64 || preserved.proofs.length > 64) fail('preserved_receipts');
  for (const resource of preserved.resources) {
    const { id, revision, createdAt, updatedAt, lastOutcome: _outcome, ...registration } = resource;
    if (
      resourceId(registration) !== id ||
      !isDeepStrictEqual(resourceRegistration(registration), registration)
    )
      fail('preserved_resource');
    replayInteger(revision, 1);
    replayInteger(createdAt);
    replayInteger(updatedAt);
  }
  for (const lease of preserved.leases) {
    validateResourceRequest(replayLeaseRequest(lease as ResourceLease));
    if (!['released', 'cancelled', 'stopped_by_owner'].includes(lease.state))
      fail('preserved_lease_live');
    replayInteger(lease.revision, 1);
    replayInteger(lease.sequence, 1);
  }
  const keys = new Set<string>();
  for (const row of preserved.journals) {
    replayKeys(row, ['key', 'bytes', 'digest']);
    replayHash(row.digest);
    replayInteger(row.bytes, 1);
    if (
      typeof row.key !== 'string' ||
      !row.key.startsWith('resources.cache-reconciliation.') ||
      row.key.length > 512 ||
      keys.has(row.key)
    )
      fail('preserved_journal_key');
    keys.add(row.key);
  }
  let proofBytes = 0;
  const paths = new Set<string>();
  for (const receipt of preserved.proofs) {
    replayKeys(receipt, ['path', 'bytes', 'digest']);
    replayHash(receipt.digest);
    replayInteger(receipt.bytes, 1);
    const directory = basename(dirname(receipt.path));
    if (!directory.startsWith('cache-reconciliation-')) fail('preserved_proof_path');
    requireReconciliationIntent(directory.slice('cache-reconciliation-'.length));
    if (
      receipt.path !== join(data, 'verification', directory, 'proof.json') ||
      paths.has(receipt.path)
    )
      fail('preserved_proof_path');
    paths.add(receipt.path);
    proofBytes += receipt.bytes;
  }
  if (proofBytes > 8 * 1024 ** 2) fail('preserved_proof_bytes');
  if (
    initializedReconciliationCandidate(journal.original.entry) ||
    initializedReconciliationPhaseCandidate(journal.evidence.phase)
  ) {
    assertInitializedReconciliationEvidence(journal);
    return;
  }
  if (
    uniqueReconciliationEntry(journal.original.entry) ||
    accounting.method === RECONCILIATION_UNIQUE_METHOD ||
    journal.evidence.phase === RECONCILIATION_UNIQUE_PHASE
  ) {
    assertUniqueReconciliationEvidence(journal);
    return;
  }
  if (accounting.method !== 'legacy-component-depth-v1') return fail('legacy_phase_accounting');
  replayKeys(accounting, [
    'method',
    'completedTarballs',
    'expandedBytes',
    'expandedFiles',
    'pending',
  ]);
  const pending = accounting.pending;
  replayKeys(pending, ['hex', 'compressedBytes', 'expandedBytes', 'expandedFiles', 'failure']);
  for (const value of [
    accounting.completedTarballs,
    accounting.expandedBytes,
    accounting.expandedFiles,
    pending.compressedBytes,
  ])
    replayInteger(value);
  const last = journal.trees.artifact.files.find(
    (file) => file.path === `tarballs/${pending.hex}.tgz`,
  );
  if (
    accounting.method !== 'legacy-component-depth-v1' ||
    accounting.completedTarballs !== journal.evidence.downloadedTarballs.length - 1 ||
    accounting.expandedBytes !== journal.original.entry.expandedBytes ||
    accounting.expandedFiles !== journal.original.entry.expandedFiles ||
    accounting.expandedBytes > NPM_INSTALL_BYTE_LIMIT ||
    accounting.expandedFiles > NPM_INSTALL_FILE_LIMIT ||
    pending.hex !== journal.evidence.downloadedTarballs.at(-1) ||
    !last ||
    pending.compressedBytes !== last.bytes
  )
    fail('legacy_phase_accounting');
  if (!validReconciliationAccountingSeam(accounting, journal.evidence.unjournaledDownloadBytes))
    fail('pending_phase_accounting');
}
