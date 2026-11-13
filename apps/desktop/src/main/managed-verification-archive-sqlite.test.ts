import { expect, it } from 'vitest';
import { encodeNativeIdentity } from './managed-native-identity';
import {
  assertDatabaseIdentity,
  assertDurabilityProof,
  validateArchiveKey,
  expectedArchiveBlobs,
} from './managed-verification-archive-sqlite';
import {
  archiveReceipt,
  useVerifiedArchive,
  type VerifiedArchive,
} from './managed-verification-archive-store';
import { sha256, type ArchiveManifest } from './managed-verification-archive-metadata';
import { removeArchivedSources } from './managed-verification-archive-remove';

const identity = encodeNativeIdentity({
  dev: 37n,
  ino: 13229323907920232n,
  birthtimeNs: 1794519347717123456n,
});
const key = {
  projectId: '309d0b61-2213-4ad5-ac89-8e790cfb591d',
  archiveId: '08d6d07e-88f5-4be3-b94d-cd34e0b13545',
  subjectIntent: '17b8db94-069c-4231-9ab0-95b44d30d1a5',
};
it('pins an exact native database identity, never rounded or adjacent inodes', () => {
  expect(() => assertDatabaseIdentity({ ...identity }, identity)).not.toThrow();
  for (const field of ['dev', 'ino', 'birthtimeNs'] as const) {
    expect(() =>
      assertDatabaseIdentity(
        { ...identity, [field]: String(BigInt(identity[field]) + 1n) },
        identity,
      ),
    ).toThrow('database_identity');
    expect(() =>
      assertDatabaseIdentity({ ...identity, [field]: Number(identity[field]) }, identity),
    ).toThrow('database_identity');
  }
  expect(() => assertDatabaseIdentity({ ...identity, filePath: 'arbitrary' }, identity)).toThrow(
    'database_identity',
  );
});
it('requires a fully settled, numeric checkpoint and exact existing database pin', () => {
  const proof = {
    databaseIdentity: identity,
    sqliteVersion: '3.52.0',
    checkpoint: { busy: 0, log: 7, checkpointed: 7 },
  };
  expect(() => assertDurabilityProof(proof, identity)).not.toThrow();
  expect(() =>
    assertDurabilityProof({ ...proof, checkpoint: { busy: 0, log: 0, checkpointed: 0 } }, identity),
  ).not.toThrow();
  for (const checkpoint of [
    { busy: 1, log: 7, checkpointed: 7 },
    { busy: 0, log: 7, checkpointed: 6 },
    { busy: 0, log: -1, checkpointed: -1 },
    { busy: 0, log: 0.5, checkpointed: 0.5 },
    { busy: 0, log: '7', checkpointed: '7' },
    { busy: 0, log: Number.MAX_SAFE_INTEGER + 1, checkpointed: Number.MAX_SAFE_INTEGER + 1 },
  ])
    expect(() => assertDurabilityProof({ ...proof, checkpoint }, identity)).toThrow(
      'durability_checkpoint',
    );
  expect(() => assertDurabilityProof({ ...proof, sqliteVersion: '' }, identity)).toThrow(
    'durability_checkpoint',
  );
  expect(() =>
    assertDurabilityProof(
      { ...proof, databaseIdentity: { ...identity, ino: '13229323907920233' } },
      identity,
    ),
  ).toThrow('database_identity');
});
it('requires explicit project/archive/subject binding, not arbitrary serialized path authority', () => {
  expect(() => validateArchiveKey(key)).not.toThrow();
  for (const changed of [
    { ...key, archiveId: '' },
    { ...key, subjectIntent: 'not-an-intent' },
    { ...key, projectId: '' },
    { ...key, projectId: 'owner\nother' },
    { ...key, archiveId: `${key.archiveId}\n` },
  ]) {
    expect(() => validateArchiveKey(changed)).toThrow('archive_key');
  }
});
it('derives a stable content-addressed set and rejects conflicting sizes for the same digest', () => {
  const digest = sha256(''),
    other = sha256('other');
  // Pure projection metadata only, never passed as a source snapshot or to any database API.
  const projection = {
    nodes: [
      { kind: 'file', digest, size: '0' },
      { kind: 'file', digest, size: '0' },
      { kind: 'directory' },
      { kind: 'file', digest: other, size: '5' },
    ],
  } as unknown as ArchiveManifest;
  expect(expectedArchiveBlobs(projection)).toEqual(
    [
      { digest, bytes: 0 },
      { digest: other, bytes: 5 },
    ].sort((a, b) => (a.digest < b.digest ? -1 : 1)),
  );
  const conflicting = {
    nodes: [...projection.nodes, { kind: 'file', digest, size: '1' }],
  } as unknown as ArchiveManifest;
  expect(() => expectedArchiveBlobs(conflicting)).toThrow('blob_size_conflict');
});
it('cannot upgrade a SQLite receipt or observation-looking JSON to a read or deletion capability', async () => {
  const receipt = JSON.parse(
    JSON.stringify({
      backend: 'sqlite-appdb-v1',
      ...key,
      databaseIdentity: identity,
      manifestDigest: sha256(''),
      deleteReady: true,
    }),
  );
  expect(() => archiveReceipt(receipt as VerifiedArchive)).toThrow('verified_capability_required');
  await expect(useVerifiedArchive(receipt, async () => 'forbidden', true)).rejects.toThrow(
    'verified_capability_required',
  );
  await expect(
    removeArchivedSources(receipt, {
      roles: ['artifact'],
      effectGate: () => {
        throw new Error('must_not_reach_effect');
      },
    }),
  ).rejects.toThrow('verified_capability_required');
});
