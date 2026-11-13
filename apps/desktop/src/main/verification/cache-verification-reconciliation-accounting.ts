import { join } from 'node:path';
import {
  npmLegacyArchiveExpansion,
  NPM_INSTALL_BYTE_LIMIT,
  NPM_INSTALL_FILE_LIMIT,
} from '../managed-npm-archive';
import type { ManagedArtifact } from '../managed-cache-store';
import type { PnpmProvenance } from '../managed-pnpm-provenance';

export interface ReconciliationAccounting {
  method: 'legacy-component-depth-v1';
  completedTarballs: number;
  expandedBytes: number;
  expandedFiles: number;
  pending: {
    hex: string;
    compressedBytes: number;
    expandedBytes?: number;
    expandedFiles?: number;
    failure: 'aggregate-expansion' | 'archive-expansion';
  };
}
/** Pure counter coupling only; no file, process, domain receipt or permission is represented here. */
export function validReconciliationAccountingSeam(
  value: Pick<ReconciliationAccounting, 'expandedBytes' | 'expandedFiles'> & {
    pending: Omit<ReconciliationAccounting['pending'], 'hex'>;
  },
  unjournaledBytes: number,
): boolean {
  const pending = value.pending;
  const valid = (count: unknown, maximum = Number.MAX_SAFE_INTEGER): count is number =>
    Number.isSafeInteger(count) && Number(count) >= 0 && Number(count) <= maximum;
  if (
    !valid(value.expandedBytes, NPM_INSTALL_BYTE_LIMIT) ||
    !valid(value.expandedFiles, NPM_INSTALL_FILE_LIMIT) ||
    !valid(unjournaledBytes) ||
    !valid(pending.compressedBytes) ||
    !pending.compressedBytes
  )
    return false;
  if (pending.failure === 'archive-expansion')
    return (
      pending.expandedBytes === undefined &&
      pending.expandedFiles === undefined &&
      unjournaledBytes === pending.compressedBytes
    );
  return (
    pending.failure === 'aggregate-expansion' &&
    unjournaledBytes === 0 &&
    valid(pending.expandedBytes, NPM_INSTALL_BYTE_LIMIT) &&
    valid(pending.expandedFiles, NPM_INSTALL_FILE_LIMIT) &&
    (value.expandedBytes + pending.expandedBytes > NPM_INSTALL_BYTE_LIMIT ||
      value.expandedFiles + pending.expandedFiles > NPM_INSTALL_FILE_LIMIT)
  );
}
/** Read-only reconstruction of the publisher's TWO precisely ordered failure seams, not a fit waiver. */
export async function readReconciliationAccounting(
  artifactPath: string,
  entry: ManagedArtifact,
  tarballs: PnpmProvenance['tarballs'],
  finalBytes: number,
  unjournaledBytes: number,
  failure: ReconciliationAccounting['pending']['failure'],
): Promise<ReconciliationAccounting> {
  if (!tarballs.length) throw new Error('cache_reconciliation_accounting_empty');
  let expandedBytes = 0,
    expandedFiles = 0;
  for (const tarball of tarballs.slice(0, -1)) {
    const result = await npmLegacyArchiveExpansion(
      join(artifactPath, 'tarballs', `${tarball.hex}.tgz`),
      tarball.copies,
      tarball.installNodes,
    );
    expandedBytes += result.expandedBytes;
    expandedFiles += result.expandedFiles;
    if (expandedBytes > NPM_INSTALL_BYTE_LIMIT || expandedFiles > NPM_INSTALL_FILE_LIMIT)
      throw new Error('cache_reconciliation_completed_prefix_overflow');
  }
  if (entry.expandedBytes !== expandedBytes || entry.expandedFiles !== expandedFiles)
    throw new Error('cache_reconciliation_legacy_counters_changed');
  const last = tarballs.at(-1)!;
  let pendingExpansion: { expandedBytes: number; expandedFiles: number } | undefined;
  try {
    pendingExpansion = await npmLegacyArchiveExpansion(
      join(artifactPath, 'tarballs', `${last.hex}.tgz`),
      last.copies,
      last.installNodes,
    );
  } catch (error) {
    if (
      failure !== 'archive-expansion' ||
      !(error instanceof Error) ||
      error.message !== 'managed_dependencies_unsupported_archive_expansion'
    )
      throw error;
  }
  const accounting: ReconciliationAccounting = {
    method: 'legacy-component-depth-v1',
    completedTarballs: tarballs.length - 1,
    expandedBytes,
    expandedFiles,
    pending: { hex: last.hex, compressedBytes: finalBytes, ...pendingExpansion, failure },
  };
  if (!validReconciliationAccountingSeam(accounting, unjournaledBytes))
    throw new Error('cache_reconciliation_pending_phase_not_proven');
  return accounting;
}
