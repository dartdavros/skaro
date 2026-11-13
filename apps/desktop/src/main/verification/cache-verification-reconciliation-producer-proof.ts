import type { AppDb, ResourceLease } from '@skaro/core';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readCacheFile } from '../managed-cache-files';
import type { ManagedArtifact } from '../managed-cache-store';
import { uniqueReconciliationEntry } from './cache-verification-reconciliation-unique';
import { uniqueReconciliationProducerFailure } from './cache-verification-reconciliation-unique-proof';
import {
  initializedReconciliationCandidate,
  validInitializedReconciliationEntry,
  initializedReconciliationIntent,
  initializedReconciliationDescriptor,
} from './cache-verification-reconciliation-initialized';
import { initializedReconciliationProducerFailure } from './cache-verification-reconciliation-initialized-proof';
import { CACHE_VERIFICATION_OWNER_SCOPE as scope } from './cache-verification-scope';
import { requireReconciliationIntent } from './cache-verification-reconciliation-identity';
import { withReplayReader } from './cache-verification-reconciliation-replay-storage';
import { RECONCILIATION_JOURNAL_KEY } from './cache-verification-reconciliation-replay-types';

function legacyProducerFailure(error: string) {
  if (
    !error.startsWith('Error: managed_dependencies_unsupported_archive_expansion\n') ||
    !error.includes('ManagedPnpmCache.published') ||
    error.includes('pnpmOwnedCommand')
  )
    throw new Error('cache_reconciliation_failed_producer_proof');
  return /at npmExpansionFits \([^\n]+\)\n\s+at ManagedPnpmCache\.published/.test(error)
    ? ('aggregate-expansion' as const)
    : ('archive-expansion' as const);
}

export interface ReconciliationProofReceipt {
  path: string;
  bytes: number;
  digest: string;
}
export async function readReconciliationProducerProof(
  data: string,
  failedIntent: string,
  project: { root: string; head: string },
  original: {
    entry?: Readonly<ManagedArtifact>;
    sourceResource: { id: string; generation: number };
    sourceLease: ResourceLease;
    dependenciesLease: ResourceLease;
  },
) {
  requireReconciliationIntent(failedIntent);
  const path = join(data, 'verification', `cache-workflow-${failedIntent}`, 'proof.json');
  const { data: bytes } = await readCacheFile(data, path, 2 * 1024 ** 2);
  const proof = JSON.parse(bytes.toString()) as Record<string, unknown>;
  const source = proof.source as Record<string, unknown> | undefined;
  if (
    proof.intentId !== failedIntent ||
    proof.projectId !== scope.projectId ||
    proof.phase !== 'dependencies' ||
    proof.passed !== false ||
    !source ||
    source.root !== project.root ||
    source.head !== project.head ||
    source.resourceId !== original.sourceResource.id ||
    source.generation !== original.sourceResource.generation ||
    typeof proof.finishedAt !== 'string' ||
    !Number.isFinite(Date.parse(proof.finishedAt)) ||
    typeof proof.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(proof.startedAt)) ||
    Date.parse(proof.startedAt) > Date.parse(proof.finishedAt) ||
    Date.parse(proof.finishedAt) <
      Math.max(original.sourceLease.updatedAt, original.dependenciesLease.updatedAt) ||
    !proof.protectedBefore ||
    !isDeepStrictEqual(proof.protectedBefore, proof.protectedAfter) ||
    !proof.foreignBefore ||
    !isDeepStrictEqual(proof.foreignBefore, proof.foreignAfter) ||
    typeof proof.projectStateBefore !== 'string' ||
    proof.projectStateBefore !== proof.projectStateAfter ||
    !isDeepStrictEqual(proof.finalLeases, [original.sourceLease, original.dependenciesLease]) ||
    typeof proof.error !== 'string'
  )
    throw new Error('cache_reconciliation_failed_producer_proof');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const descriptor = initializedReconciliationIntent(failedIntent);
  const initialized =
    !!descriptor || (original.entry && initializedReconciliationCandidate(original.entry));
  if (
    initialized &&
    (!descriptor ||
      !original.entry ||
      initializedReconciliationDescriptor(original.entry) !== descriptor ||
      !validInitializedReconciliationEntry(original.entry) ||
      digest !== descriptor.attempt.producerDigest)
  )
    throw new Error('cache_reconciliation_initialized_failed_producer_proof');
  const failure = initialized
    ? initializedReconciliationProducerFailure(proof)
    : original.entry && uniqueReconciliationEntry(original.entry)
      ? uniqueReconciliationProducerFailure(proof)
      : legacyProducerFailure(proof.error as string);
  return { receipt: { path, bytes: bytes.length, digest }, failure };
}
export async function verifyReconciliationProof(data: string, receipt: ReconciliationProofReceipt) {
  const { data: bytes } = await readCacheFile(data, receipt.path, 8 * 1024 ** 2);
  if (
    bytes.length !== receipt.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== receipt.digest
  )
    throw new Error('cache_reconciliation_producer_proof_changed');
}

/** Bounded SQL hashes preserve historical completed journals without treating them as active authority. */
export function reconciliationPriorJournals(db: AppDb, excludingKey?: string) {
  const rows = withReplayReader(db, (reader) => {
    const where = 'key <> ? AND (key=? OR key LIKE ?)';
    const parameters = [
      excludingKey ?? '',
      RECONCILIATION_JOURNAL_KEY,
      `resources.cache-reconciliation.${scope.projectId}.%`,
    ];
    const size = reader
      .prepare(
        `SELECT count(*) AS nodes, coalesce(sum(length(CAST(value AS BLOB))),0) AS bytes FROM settings WHERE ${where}`,
      )
      .get(...parameters)!;
    if (Number(size.nodes) > 64 || Number(size.bytes) > 8 * 1024 ** 2)
      throw new Error('cache_reconciliation_prior_journal_limit');
    return reader
      .prepare(`SELECT key,value FROM settings WHERE ${where} ORDER BY key`)
      .all(...parameters);
  }) as { key: string; value: string | null }[];
  if (rows.length > 64 || rows.some((row) => row.value === null))
    throw new Error('cache_reconciliation_prior_journal_limit');
  return rows
    .filter((row) => row.key !== excludingKey)
    .map((row) => ({
      key: row.key,
      bytes: Buffer.byteLength(row.value!),
      digest: createHash('sha256').update(row.value!).digest('hex'),
    }));
}
