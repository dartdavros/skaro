import type { ManagedArtifact } from '../managed-cache-store';
import { NPM_INSTALL_BYTE_LIMIT, NPM_INSTALL_FILE_LIMIT } from '../managed-npm-archive';
import { pnpmLockTarballs } from '../managed-pnpm-lock';
import { RECONCILIATION_UNIQUE_METHOD } from './cache-verification-reconciliation-unique';
import { readReconciliationArchiveFacts } from './cache-verification-reconciliation-archive-facts';

export interface UniqueReconciliationAccounting {
  method: typeof RECONCILIATION_UNIQUE_METHOD;
  complete: true;
  completedTarballs: number;
  expandedBytes: number;
  expandedFiles: number;
  payloadBytes: number;
  shimFiles: number;
  shimBytes: number;
  metadataFiles: 3;
}
/** Pure counter contract only, never archive provenance, executor closure or deletion authority. */
export function validUniqueReconciliationAccounting(
  value: UniqueReconciliationAccounting,
  tarballs: number,
  unjournaledBytes: number,
) {
  return (
    !Object.hasOwn(value, 'pending') &&
    value.method === RECONCILIATION_UNIQUE_METHOD &&
    value.complete === true &&
    value.completedTarballs === tarballs &&
    Number.isSafeInteger(tarballs) &&
    tarballs > 0 &&
    tarballs <= NPM_INSTALL_FILE_LIMIT &&
    unjournaledBytes === 0 &&
    [
      value.expandedBytes,
      value.expandedFiles,
      value.payloadBytes,
      value.shimFiles,
      value.shimBytes,
    ].every((count) => Number.isSafeInteger(count) && count >= 0) &&
    value.expandedFiles > 0 &&
    value.expandedFiles <= NPM_INSTALL_FILE_LIMIT &&
    value.expandedBytes <= NPM_INSTALL_BYTE_LIMIT &&
    value.shimBytes === value.shimFiles * 64 * 1024 &&
    value.expandedBytes === value.payloadBytes + value.shimBytes &&
    value.metadataFiles === 3
  );
}
/** Replays ALL verified original-lock archive facts through the current unique-node planner. */
export async function readUniqueReconciliationAccounting(
  root: string,
  artifactPath: string,
  entry: ManagedArtifact,
  lock: unknown,
): Promise<UniqueReconciliationAccounting> {
  const { complete } = await readReconciliationArchiveFacts(root, artifactPath, lock);
  return completeReconciliationAccounting(entry, pnpmLockTarballs(lock).length, complete);
}

export function completeReconciliationAccounting(
  entry: Readonly<ManagedArtifact>,
  completedTarballs: number,
  result: Awaited<ReturnType<typeof readReconciliationArchiveFacts>>['complete'],
): UniqueReconciliationAccounting {
  if (!result.complete || result.missingPackageIds.length !== 0)
    throw new Error('cache_reconciliation_unique_incomplete_archives');
  const accounting: UniqueReconciliationAccounting = {
    method: RECONCILIATION_UNIQUE_METHOD,
    complete: true,
    completedTarballs,
    expandedBytes: result.expandedBytes,
    expandedFiles: result.nodes,
    payloadBytes: result.payloadBytes,
    shimFiles: result.shimFiles,
    shimBytes: result.shimBytes,
    metadataFiles: 3,
  };
  if (
    !validUniqueReconciliationAccounting(accounting, accounting.completedTarballs, 0) ||
    entry.expandedBytes !== accounting.expandedBytes ||
    entry.expandedFiles !== accounting.expandedFiles
  )
    throw new Error('cache_reconciliation_unique_counters_changed');
  return accounting;
}
