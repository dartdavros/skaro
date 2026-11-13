import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { validExactNativeIdentity, type ExactNativeIdentity } from '../managed-native-identity';
import type { ArchiveAllocation } from './cache-archive-allocation';
import type { AppDb, ResourceLease, ResourceLeaseRequest } from '@skaro/core';
import type { ArchiveManifest, ArchiveRoots } from '../managed-verification-archive-metadata';
import type { archiveReceipt } from '../managed-verification-archive-store';
import type { ReconciliationPreserved } from './cache-verification-reconciliation-preserved';
import type { ReconciliationProofReceipt } from './cache-verification-reconciliation-producer-proof';
import {
  SIXTH_ARCHIVE,
  SIXTH_ARCHIVE_KEY,
  assertSixthOriginal,
  type SixthArchiveOriginal,
} from './cache-archive-sixth-identity';
import { CACHE_VERIFICATION_OWNER_SCOPE as scope } from './cache-verification-scope';
import {
  archiveMetadataSummary,
  validateManifest,
  manifestText,
  sha256,
} from '../managed-verification-archive-metadata';

export interface ArchivePreparation {
  request: ResourceLeaseRequest;
  pid: number;
  birth: string;
  at: number;
}
export interface ArchiveSession {
  lease: ResourceLease;
  pid: number;
  birth: string;
}
export interface SixthArchiveJournal {
  version: 'owner-archive-before-delete-v1';
  approval: typeof SIXTH_ARCHIVE.approval;
  createdAt: number;
  project: { projectId: string; root: string; head: string };
  original: SixthArchiveOriginal;
  roots: ArchiveRoots;
  snapshot: ArchiveManifest;
  producerProof: ReconciliationProofReceipt;
  preserved: ReconciliationPreserved;
  diskDevice: string;
  allocationUnit: number;
  allocationBytes: number;
  snapshotDigest: string;
  archiveId: string;
  databaseIdentity: ExactNativeIdentity;
  allocation: ArchiveAllocation;
  state: 'planned' | 'archived' | 'complete';
  preparations: ArchivePreparation[];
  sessions: ArchiveSession[];
  backup?: ReturnType<typeof archiveReceipt>;
}
export const archiveDigest = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const sixthSnapshotDigest = (j: SixthArchiveJournal) =>
  archiveDigest({
    version: j.version,
    approval: j.approval,
    createdAt: j.createdAt,
    project: j.project,
    original: j.original,
    roots: j.roots,
    snapshot: manifestText(j.snapshot),
    producerProof: j.producerProof,
    preserved: j.preserved,
    diskDevice: j.diskDevice,
    allocationUnit: j.allocationUnit,
    allocationBytes: j.allocationBytes,
    archiveId: j.archiveId,
    databaseIdentity: j.databaseIdentity,
    allocation: j.allocation,
  });
export function assertSixthArchiveJournal(j: SixthArchiveJournal, data: string): void {
  const fail = () => {
    throw new Error('cache_archive_journal_invalid');
  };
  if (
    !j ||
    j.version !== 'owner-archive-before-delete-v1' ||
    j.approval !== SIXTH_ARCHIVE.approval ||
    !Number.isSafeInteger(j.createdAt) ||
    j.createdAt <= 0 ||
    j.project?.projectId !== scope.projectId ||
    j.project.root !== scope.root ||
    j.project.head !== 'f8ecfcf2ac53ebae686e81af7f0a7af12948224d' ||
    !['planned', 'archived', 'complete'].includes(j.state) ||
    !Array.isArray(j.preparations) ||
    j.preparations.length > 8 ||
    !Array.isArray(j.sessions) ||
    j.sessions.length > 8 ||
    !/^[1-9][0-9]{0,19}$/.test(j.diskDevice) ||
    Buffer.byteLength(JSON.stringify(j)) > 8 * 1024 ** 2
  )
    fail();
  assertSixthOriginal(j.original, join(data, 'managed-caches-v1'));
  const expected = {
    artifact: join(data, 'managed-caches-v1', 'dependencies', SIXTH_ARCHIVE.key),
    scratch: join(
      data,
      'managed-caches-v1',
      'scratch',
      `${SIXTH_ARCHIVE.key}-1-original-lock-proof`,
    ),
    stage: j.original.stageResource.identity.path!,
  };
  if (archiveDigest(j.roots) !== archiveDigest(expected)) fail();
  validateManifest(j.snapshot, expected);
  const summary = archiveMetadataSummary(j.snapshot);
  if (
    !Number.isSafeInteger(j.allocationUnit) ||
    j.allocationUnit <= 0 ||
    j.allocationUnit > 65536 ||
    !Number.isSafeInteger(j.allocationBytes) ||
    j.allocationBytes !== j.allocation?.reserveBytes ||
    j.allocationBytes <= Number(summary.reservationBytes) ||
    j.allocationBytes > SIXTH_ARCHIVE.diskBytes ||
    !validExactNativeIdentity(j.databaseIdentity) ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(j.archiveId)
  )
    fail();
  if (
    j.producerProof.digest !== SIXTH_ARCHIVE.producerDigest ||
    j.producerProof.path !==
      join(data, 'verification', `cache-workflow-${SIXTH_ARCHIVE.intent}`, 'proof.json') ||
    !Number.isSafeInteger(j.producerProof.bytes) ||
    j.producerProof.bytes <= 0 ||
    j.producerProof.bytes > 2 * 1024 ** 2 ||
    sixthSnapshotDigest(j) !== j.snapshotDigest
  )
    fail();
  if ((j.state !== 'planned') !== !!j.backup) fail();
  if (j.backup) {
    const expectedSummary = archiveMetadataSummary(j.snapshot);
    if (
      j.backup.backend !== 'sqlite-appdb-v1' ||
      j.backup.archiveId !== j.archiveId ||
      j.backup.projectId !== j.project.projectId ||
      j.backup.subjectIntent !== SIXTH_ARCHIVE.intent ||
      archiveDigest(j.backup.databaseIdentity) !== archiveDigest(j.databaseIdentity) ||
      j.backup.manifestDigest !== sha256(manifestText(j.snapshot)) ||
      Object.entries(expectedSummary).some(
        ([k, v]) => j.backup![k as keyof typeof expectedSummary] !== v,
      )
    )
      fail();
  }
  const ids = new Set<string>();
  for (const p of j.preparations) {
    if (
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(p.request.id) ||
      ids.has(p.request.id) ||
      !Number.isSafeInteger(p.pid) ||
      p.pid <= 0 ||
      !p.birth ||
      p.pid === SIXTH_ARCHIVE.pid ||
      !Number.isSafeInteger(p.at) ||
      p.at < j.createdAt
    )
      fail();
    ids.add(p.request.id);
  }
  for (const s of j.sessions) {
    const p = j.preparations.find((p) => p.request.id === s.lease.id);
    if (!p || s.pid !== p.pid || s.birth !== p.birth) fail();
  }
}
export function loadSixthArchiveJournal(db: AppDb, data: string) {
  const value = db.getSetting<SixthArchiveJournal | undefined>(SIXTH_ARCHIVE_KEY, undefined, {
    strict: true,
  });
  if (value) assertSixthArchiveJournal(value, data);
  return value;
}
export function saveSixthArchiveJournal(db: AppDb, data: string, value: SixthArchiveJournal) {
  assertSixthArchiveJournal(value, data);
  const current = loadSixthArchiveJournal(db, data);
  if (current) {
    if (
      current.snapshotDigest !== value.snapshotDigest ||
      ['planned', 'archived', 'complete'].indexOf(value.state) <
        ['planned', 'archived', 'complete'].indexOf(current.state) ||
      JSON.stringify(value.preparations.slice(0, current.preparations.length)) !==
        JSON.stringify(current.preparations) ||
      JSON.stringify(value.sessions.slice(0, current.sessions.length)) !==
        JSON.stringify(current.sessions)
    )
      throw new Error('cache_archive_journal_transition_changed');
    if (current.state === 'complete' && JSON.stringify(current) !== JSON.stringify(value))
      throw new Error('cache_archive_completed_journal_immutable');
  }
  db.setSetting(SIXTH_ARCHIVE_KEY, value);
}
