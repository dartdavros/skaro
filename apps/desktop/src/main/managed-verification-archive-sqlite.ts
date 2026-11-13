import type { AppDb } from '@skaro/core';
import { isAbsolute, normalize } from 'node:path';
import { validExactNativeIdentity, type ExactNativeIdentity } from './managed-native-identity';
import {
  ARCHIVE_LIMITS,
  ARCHIVE_ROLES,
  digestValid,
  fail,
  manifestText,
  sha256,
  within,
  type ArchiveManifest,
  type ArchiveRoots,
} from './managed-verification-archive-metadata';
import { gateNow, type HostGate } from './managed-verification-archive-paths';

export interface ArchiveKey {
  readonly projectId: string;
  readonly archiveId: string;
  readonly subjectIntent: string;
}
export interface ArchiveStorageState {
  readonly manifest: ArchiveManifest;
  readonly manifestDigest: string;
  readonly database: AppDb;
  readonly key: ArchiveKey;
  readonly databaseIdentity: ExactNativeIdentity;
  readonly deleteReady: boolean;
}
export function validateArchiveKey(key: ArchiveKey): void {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (
    ![key.projectId, key.archiveId, key.subjectIntent].every(
      (value) => typeof value === 'string' && value.length === 36 && uuid.test(value),
    )
  )
    fail('archive_key');
}
export function assertDatabaseIdentity(
  actual: unknown,
  expected: unknown,
): asserts actual is ExactNativeIdentity {
  if (
    !validExactNativeIdentity(actual) ||
    !validExactNativeIdentity(expected) ||
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino ||
    actual.birthtimeNs !== expected.birthtimeNs
  )
    fail('database_identity');
}
export function databaseScope(database: AppDb, roots: ArchiveRoots): void {
  const path = database.filePath;
  if (
    !isAbsolute(path) ||
    normalize(path) !== path ||
    ARCHIVE_ROLES.some((role) => within(roots[role], path))
  )
    fail('database_source_scope');
}
export function requireDatabaseIdentity(state: Readonly<ArchiveStorageState>): void {
  assertDatabaseIdentity(
    state.database.verificationArchives.databaseIdentity,
    state.databaseIdentity,
  );
}
export function expectedArchiveBlobs(
  manifest: ArchiveManifest,
): { digest: string; bytes: number }[] {
  const unique = new Map<string, number>();
  for (const node of manifest.nodes)
    if (node.kind === 'file') {
      if (!digestValid(node.digest) || BigInt(node.size) > BigInt(ARCHIVE_LIMITS.file))
        fail('blob_metadata');
      const bytes = Number(node.size),
        previous = unique.get(node.digest);
      if (!Number.isSafeInteger(bytes) || bytes < 0) fail('blob_metadata');
      if (previous !== undefined && previous !== bytes) fail('blob_size_conflict');
      unique.set(node.digest, bytes);
    }
  return [...unique]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([digest, bytes]) => ({ digest, bytes }));
}
export function assertDurabilityProof(proof: unknown, expectedIdentity: ExactNativeIdentity): void {
  if (!proof || typeof proof !== 'object') fail('durability_proof');
  const value = proof as {
    databaseIdentity?: unknown;
    sqliteVersion?: unknown;
    checkpoint?: { busy?: unknown; log?: unknown; checkpointed?: unknown };
  };
  assertDatabaseIdentity(value.databaseIdentity, expectedIdentity);
  const checkpoint = value.checkpoint;
  if (
    typeof value.sqliteVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(value.sqliteVersion) ||
    !checkpoint ||
    checkpoint.busy !== 0 ||
    !Number.isSafeInteger(checkpoint.log) ||
    Number(checkpoint.log) < 0 ||
    checkpoint.checkpointed !== checkpoint.log
  )
    fail('durability_checkpoint');
}
export function requireArchiveDurability(
  state: Readonly<ArchiveStorageState>,
  hostGate: HostGate,
): void {
  requireDatabaseIdentity(state);
  const proof = state.database.verificationArchives.durabilityBarrier(state.key, () => {
    requireDatabaseIdentity(state);
    gateNow(hostGate);
  });
  assertDurabilityProof(proof, state.databaseIdentity);
  requireDatabaseIdentity(state);
}
/** Read-only: requery header and EVERY BLOB, reject any extra/missing digest or changed native DB. */
export function verifyArchiveStorageState(state: Readonly<ArchiveStorageState>): void {
  requireDatabaseIdentity(state);
  databaseScope(state.database, state.manifest.roots);
  const archives = state.database.verificationArchives;
  const header = archives.header(state.key);
  const text = manifestText(state.manifest);
  if (
    !header?.sealed ||
    header.manifest !== text ||
    header.manifestDigest !== state.manifestDigest ||
    sha256(header.manifest) !== state.manifestDigest
  )
    fail('manifest_digest');
  const expected = expectedArchiveBlobs(state.manifest);
  const blobs = archives.blobs(state.key);
  if (blobs.length !== expected.length) fail('blob_set');
  const actual = [...blobs].sort((a, b) =>
    a.digest < b.digest ? -1 : a.digest > b.digest ? 1 : 0,
  );
  for (let index = 0; index < expected.length; index++) {
    const entry = expected[index]!,
      observed = actual[index]!;
    if (entry.digest !== observed.digest || entry.bytes !== observed.bytes) fail('blob_set');
    const bytes = archives.readBlob(state.key, entry.digest);
    if (!Buffer.isBuffer(bytes) || bytes.length !== entry.bytes || sha256(bytes) !== entry.digest)
      fail('blob_digest');
    requireDatabaseIdentity(state);
  }
  const final = archives.header(state.key);
  if (!final?.sealed || final.manifest !== text || final.manifestDigest !== state.manifestDigest)
    fail('manifest_changed');
  requireDatabaseIdentity(state);
}
