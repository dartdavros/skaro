import type { AppDb } from '@skaro/core';
import { validExactNativeIdentity, type ExactNativeIdentity } from './managed-native-identity';
import {
  ARCHIVE_LIMITS,
  ARCHIVE_ROLES,
  archiveMetadataSummary,
  digestValid,
  fail,
  manifestText,
  parseManifest,
  sha256,
  validateManifest,
  validateRoots,
  type ArchiveManifest,
  type ArchiveRoots,
} from './managed-verification-archive-metadata';
import { gateNow, nodePath, type HostGate } from './managed-verification-archive-paths';
import {
  readBoundFile,
  snapshotArchiveSources,
  verifyRemainingSources,
} from './managed-verification-archive-snapshot';
import {
  assertDatabaseIdentity,
  databaseScope,
  expectedArchiveBlobs,
  requireArchiveDurability,
  requireDatabaseIdentity,
  validateArchiveKey,
  verifyArchiveStorageState,
  type ArchiveKey,
  type ArchiveStorageState,
} from './managed-verification-archive-sqlite';

declare const verifiedBrand: unique symbol;
/** Both observation and delete-ready tokens are opaque; only private state distinguishes authority. */
export interface VerifiedArchive {
  readonly [verifiedBrand]: true;
}
const verified = new WeakSet<object>();
const states = new WeakMap<object, Readonly<ArchiveStorageState>>();
const active = new WeakSet<object>();
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function admit(state: ArchiveStorageState): VerifiedArchive {
  const capability = Object.freeze({}) as VerifiedArchive;
  // Never recursively freeze the AppDb instance or its live shared connection.
  const frozen = Object.freeze({
    ...state,
    manifest: deepFreeze(state.manifest),
    key: Object.freeze({ ...state.key }),
    databaseIdentity: Object.freeze({ ...state.databaseIdentity }),
  });
  verified.add(capability);
  states.set(capability, frozen);
  return capability;
}
/** Serialized receipts cannot enter these WeakSets. Observation tokens cannot authorize deletion. */
export async function useVerifiedArchive<T>(
  capability: VerifiedArchive,
  action: (state: Readonly<ArchiveStorageState>) => Promise<T>,
  deleteRequired = false,
): Promise<T> {
  if (!capability || !verified.has(capability) || active.has(capability))
    fail('verified_capability_required');
  const state = states.get(capability)!;
  if (deleteRequired && !state.deleteReady) fail('delete_ready_capability_required');
  active.add(capability);
  try {
    return await action(state);
  } finally {
    active.delete(capability);
  }
}
export function archiveReceipt(capability: VerifiedArchive) {
  if (!verified.has(capability)) fail('verified_capability_required');
  const state = states.get(capability)!;
  requireDatabaseIdentity(state);
  return Object.freeze({
    backend: 'sqlite-appdb-v1' as const,
    ...state.key,
    manifestDigest: state.manifestDigest,
    databaseIdentity: Object.freeze({ ...state.databaseIdentity }),
    ...archiveMetadataSummary(state.manifest),
  });
}
export async function inspectArchivedSources(capability: VerifiedArchive) {
  return useVerifiedArchive(capability, async (state) => {
    await verifyArchiveStorage(state);
    const remaining = await verifyRemainingSources(state.manifest);
    requireDatabaseIdentity(state);
    const absent = Object.freeze(
      Object.fromEntries(ARCHIVE_ROLES.map((role) => [role, !remaining.has(`${role}:`)])) as Record<
        (typeof ARCHIVE_ROLES)[number],
        boolean
      >,
    );
    return Object.freeze({ absent, remainingNodes: remaining.size });
  });
}
/** Read-only verification; no barrier, checkpoint or other write occurs here. */
export async function verifyArchiveStorage(state: Readonly<ArchiveStorageState>): Promise<void> {
  verifyArchiveStorageState(state);
}
export async function createVerifiedArchive(options: {
  snapshot: ArchiveManifest;
  database: AppDb;
  archiveId: string;
  projectId: string;
  subjectIntent: string;
  hostGate: HostGate;
}): Promise<VerifiedArchive> {
  // Copy the caller's metadata and pin the existing AppDb before the first await.
  const manifest = parseManifest(manifestText(options.snapshot), options.snapshot.roots);
  validateManifest(options.snapshot, manifest.roots);
  const { database, hostGate, archiveId, projectId, subjectIntent } = options;
  const key: ArchiveKey = { archiveId, projectId, subjectIntent };
  validateArchiveKey(key);
  databaseScope(database, manifest.roots);
  const identity = database.verificationArchives.databaseIdentity;
  if (!validExactNativeIdentity(identity)) fail('database_identity');
  const text = manifestText(manifest),
    summary = archiveMetadataSummary(manifest);
  // Logical lower bound only: parent reserves DB/WAL/allocation/journal overhead under its fence.
  if (
    BigInt(summary.reservationBytes) > BigInt(ARCHIVE_LIMITS.bytes) ||
    summary.manifestBytes > ARCHIVE_LIMITS.file
  )
    fail('archive_reservation');
  const state: ArchiveStorageState = {
    manifest,
    database,
    key,
    manifestDigest: sha256(text),
    databaseIdentity: Object.freeze({ ...identity }),
    deleteReady: true,
  };
  const writeGate = () => {
    requireDatabaseIdentity(state);
    gateNow(hostGate);
  };
  gateNow(hostGate);
  if (manifestText(await snapshotArchiveSources(manifest.roots)) !== text) fail('snapshot_changed');
  writeGate();
  const previous = database.verificationArchives.header(key);
  if (previous && (previous.manifest !== text || previous.manifestDigest !== state.manifestDigest))
    fail('archive_replay_manifest');
  if (!previous) database.verificationArchives.create(key, text, writeGate);
  const expected = expectedArchiveBlobs(manifest);
  const existing = database.verificationArchives.blobs(key);
  if (
    existing.some(
      (blob) => !expected.some((item) => item.digest === blob.digest && item.bytes === blob.bytes),
    )
  )
    fail('archive_replay_blobs');
  const files = new Map(
    manifest.nodes.filter((node) => node.kind === 'file').map((node) => [node.digest!, node]),
  );
  for (const { digest, bytes } of expected) {
    if (existing.some((blob) => blob.digest === digest)) {
      const content = database.verificationArchives.readBlob(key, digest);
      if (content.length !== bytes || sha256(content) !== digest)
        fail('archive_replay_blob_digest');
      continue;
    }
    const node = files.get(digest)!;
    // Exact pre-sized allocation, <=32MiB. readBoundFile itself streams <=1MiB and verifies the FD.
    const content = Buffer.alloc(bytes);
    let offset = 0;
    await readBoundFile(nodePath(manifest.roots, node), node, async (chunk) => {
      if (offset + chunk.length > content.length) fail('file_grew');
      chunk.copy(content, offset);
      offset += chunk.length;
    });
    if (offset !== bytes || sha256(content) !== digest) fail('source_copy_digest');
    writeGate();
    database.verificationArchives.putBlob(key, digest, content, writeGate);
    requireDatabaseIdentity(state);
  }
  // Also rehash every duplicate-content original, directory and raw link leaf.
  if (manifestText(await snapshotArchiveSources(manifest.roots)) !== text)
    fail('source_changed_during_copy');
  writeGate();
  if (!previous?.sealed) database.verificationArchives.seal(key, expected, writeGate);
  requireArchiveDurability(state, hostGate);
  await verifyArchiveStorage(state); // Must requery/hash after seal + successful FULL checkpoint.
  if (manifestText(await snapshotArchiveSources(manifest.roots)) !== text)
    fail('source_changed_after_copy');
  requireDatabaseIdentity(state);
  gateNow(hostGate);
  return admit(state);
}
export async function reopenVerifiedArchive(options: {
  database: AppDb;
  expectedArchiveId: string;
  expectedProjectId: string;
  expectedSubjectIntent: string;
  expectedDatabaseIdentity: ExactNativeIdentity;
  expectedManifestDigest: string;
  expectedRoots: ArchiveRoots;
  hostGate: HostGate;
  durability: 'verify-only' | 'delete-ready';
}): Promise<VerifiedArchive> {
  const { database, hostGate, durability, expectedManifestDigest } = options;
  const roots = { ...options.expectedRoots };
  const key: ArchiveKey = {
    archiveId: options.expectedArchiveId,
    projectId: options.expectedProjectId,
    subjectIntent: options.expectedSubjectIntent,
  };
  const databaseIdentity = Object.freeze({ ...options.expectedDatabaseIdentity });
  validateRoots(roots);
  validateArchiveKey(key);
  if (!digestValid(expectedManifestDigest)) fail('expected_digest_required');
  if (!['verify-only', 'delete-ready'].includes(durability)) fail('durability_mode_required');
  databaseScope(database, roots);
  assertDatabaseIdentity(database.verificationArchives.databaseIdentity, databaseIdentity);
  gateNow(hostGate);
  const header = database.verificationArchives.header(key);
  if (
    !header?.sealed ||
    header.manifestDigest !== expectedManifestDigest ||
    sha256(header.manifest) !== expectedManifestDigest
  )
    fail('manifest_digest');
  const manifest = parseManifest(header.manifest, roots);
  const state: ArchiveStorageState = {
    database,
    key,
    databaseIdentity,
    manifest,
    manifestDigest: expectedManifestDigest,
    deleteReady: durability === 'delete-ready',
  };
  if (state.deleteReady) requireArchiveDurability(state, hostGate);
  await verifyArchiveStorage(state);
  await verifyRemainingSources(manifest); // Missing known originals only; never a replacement baseline.
  requireDatabaseIdentity(state);
  gateNow(hostGate);
  return admit(state);
}
