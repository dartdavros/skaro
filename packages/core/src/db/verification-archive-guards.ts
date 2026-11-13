import { createHash } from 'node:crypto';

export interface VerificationArchiveKey {
  projectId: string;
  archiveId: string;
  subjectIntent: string;
}
export interface VerificationArchiveBlob {
  digest: string;
  bytes: number;
}
export interface VerificationArchiveDatabaseIdentity {
  version: 'native-bigint-v1';
  dev: string;
  ino: string;
  birthtimeNs: string;
}
export interface VerificationArchiveHeader {
  manifest: string;
  manifestDigest: string;
  sealed: boolean;
}
export interface VerificationArchiveReceipt {
  databaseIdentity: VerificationArchiveDatabaseIdentity;
  sqliteVersion: string;
  checkpoint: { busy: 0; log: number; checkpointed: number };
}
export type VerificationArchiveHostGate = () => void;
export const ARCHIVE_BLOB_LIMIT = 32 * 1024 ** 2;
export const ARCHIVE_TOTAL_LIMIT = 256 * 1024 ** 2;
export const ARCHIVE_NODE_LIMIT = 20000;
export const ARCHIVE_MANIFEST_LIMIT = 32 * 1024 ** 2;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const archiveDigest = (data: string | Buffer) =>
  createHash('sha256').update(data).digest('hex');
export function archiveKey(key: VerificationArchiveKey, scope?: string): [string, string, string] {
  if (
    !key ||
    ![key.projectId, key.archiveId, key.subjectIntent].every(
      (x) => typeof x === 'string' && x.length === 36 && uuid.test(x),
    ) ||
    (scope !== undefined && scope !== key.projectId)
  )
    throw new Error('verification_archive_scope_invalid');
  return [key.projectId, key.archiveId, key.subjectIntent];
}
export function assertArchiveDigest(digest: string): void {
  if (typeof digest !== 'string' || digest.length !== 64 || !/^[a-f0-9]{64}$/.test(digest))
    throw new Error('verification_archive_digest_invalid');
}
export function archiveManifest(text: string): { bytes: number; digest: string } {
  if (typeof text !== 'string' || text.length === 0)
    throw new Error('verification_archive_manifest_invalid');
  const bytes = Buffer.byteLength(text);
  if (bytes > ARCHIVE_MANIFEST_LIMIT) throw new Error('verification_archive_manifest_limit');
  if (Buffer.from(text).toString('utf8') !== text)
    throw new Error('verification_archive_manifest_invalid');
  return { bytes, digest: archiveDigest(text) };
}
export function archiveBlob(data: Buffer, digest: string): void {
  assertArchiveDigest(digest);
  if (!Buffer.isBuffer(data) || data.length > ARCHIVE_BLOB_LIMIT)
    throw new Error('verification_archive_blob_limit');
  if (archiveDigest(data) !== digest) throw new Error('verification_archive_blob_digest_changed');
}
export function archiveBlobSet(
  input: readonly VerificationArchiveBlob[],
  manifestBytes = 0,
): VerificationArchiveBlob[] {
  if (!Array.isArray(input) || input.length > ARCHIVE_NODE_LIMIT)
    throw new Error('verification_archive_node_limit');
  let total = manifestBytes;
  if (!Number.isSafeInteger(total) || total < 0 || total > ARCHIVE_MANIFEST_LIMIT)
    throw new Error('verification_archive_manifest_limit');
  const seen = new Set<string>();
  for (const row of input) {
    assertArchiveDigest(row.digest);
    if (
      !Number.isSafeInteger(row.bytes) ||
      row.bytes < 0 ||
      row.bytes > ARCHIVE_BLOB_LIMIT ||
      seen.has(row.digest)
    )
      throw new Error('verification_archive_blob_set_invalid');
    seen.add(row.digest);
    total += row.bytes;
    if (total > ARCHIVE_TOTAL_LIMIT) throw new Error('verification_archive_total_limit');
  }
  return input
    .map(({ digest, bytes }) => ({ digest, bytes }))
    .sort((a, b) => a.digest.localeCompare(b.digest));
}
/** Only fixed releases/backport branches of the WAL-reset fix are eligible to write. */
export function archiveSqliteVersion(version: string): void {
  if (typeof version !== 'string' || version.trim() !== version || !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('verification_archive_sqlite_unsupported');
  const [major, minor, patch] = version.split('.').map(Number) as [number, number, number];
  if (
    ![major, minor, patch].every(Number.isSafeInteger) ||
    !(
      major > 3 ||
      (major === 3 &&
        (minor > 51 ||
          (minor === 51 && patch >= 3) ||
          (minor === 50 && patch >= 7) ||
          (minor === 44 && patch >= 6)))
    )
  )
    throw new Error('verification_archive_sqlite_unsupported');
}
export function archivePageSize(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 512 ||
    value > 65536 ||
    (value & (value - 1)) !== 0
  )
    throw new Error('verification_archive_page_size_invalid');
  return value;
}
export function archiveCheckpoint(row: unknown): VerificationArchiveReceipt['checkpoint'] {
  const value = row as Record<string, unknown> | undefined;
  if (
    !value ||
    value.busy !== 0 ||
    !Number.isSafeInteger(value.log) ||
    Number(value.log) < 0 ||
    !Number.isSafeInteger(value.checkpointed) ||
    value.checkpointed !== value.log
  )
    throw new Error('verification_archive_checkpoint_incomplete');
  return { busy: 0, log: value.log as number, checkpointed: value.checkpointed as number };
}
