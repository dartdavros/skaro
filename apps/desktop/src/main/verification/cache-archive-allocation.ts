import { lstatSync } from 'node:fs';
import type { AppDb } from '@skaro/core';
import {
  archiveMetadataSummary,
  type ArchiveManifest,
} from '../managed-verification-archive-metadata';

export interface ArchiveAllocation {
  pageSize: number;
  databaseBytes: number;
  walBytes: number;
  reserveBytes: number;
}
function fileBytes(path: string, optional = false): number {
  try {
    const info = lstatSync(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      !Number.isSafeInteger(info.size)
    )
      throw new Error('cache_archive_allocation_file');
    return info.size;
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}
/** Includes fresh B-tree/overflow pages, WAL frames, existing WAL backlog and bounded journal slack. */
export function archiveAllocation(db: AppDb, snapshot: ArchiveManifest): ArchiveAllocation {
  const summary = archiveMetadataSummary(snapshot),
    pageSize = db.verificationArchives.pageSize;
  const walBytes = fileBytes(`${db.filePath}-wal`, true);
  const pages =
    Math.ceil(Number(summary.blobBytes) / (pageSize - 128)) +
    Math.ceil(summary.manifestBytes / (pageSize - 128)) +
    (summary.blobCount + 16) * 8;
  const reserveBytes = pages * (pageSize * 2 + 24) + walBytes + 32 * 1024 ** 2;
  if (!Number.isSafeInteger(reserveBytes)) throw new Error('cache_archive_allocation_overflow');
  return { pageSize, databaseBytes: fileBytes(db.filePath), walBytes, reserveBytes };
}
/** Rechecked before every SQL mutation and every original unlink, under the live controller/fence. */
export function requireArchiveAllocation(
  db: AppDb,
  original: ArchiveAllocation,
  limit: number,
): void {
  if (db.verificationArchives.pageSize !== original.pageSize || original.reserveBytes > limit)
    throw new Error('cache_archive_allocation_changed');
  const growth =
    Math.max(0, fileBytes(db.filePath) - original.databaseBytes) +
    fileBytes(`${db.filePath}-wal`, true);
  // Retain room for a maximum supported BLOB and its WAL frames before permitting the next write.
  if (growth + 64 * 1024 ** 2 > limit) throw new Error('cache_archive_allocation_exhausted');
}
