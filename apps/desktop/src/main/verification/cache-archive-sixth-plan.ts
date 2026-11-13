import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { archiveAllocation } from './cache-archive-allocation';
import { lstat, statfs } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import type { AppDb } from '@skaro/core';
import { ManagedCacheStore } from '../managed-cache-store';
import { cacheTree, readCacheFile } from '../managed-cache-files';
import { readManagedPnpmInput } from '../managed-pnpm-provenance';
import { snapshotArchiveSources } from '../managed-verification-archive-snapshot';
import { manifestText } from '../managed-verification-archive-metadata';
import {
  cacheVerificationProject,
  CACHE_VERIFICATION_OWNER_SCOPE as scope,
} from './cache-verification-scope';
import {
  pnpmInputVersion,
  requireNativeAbsence,
  reconciliationHash,
} from './cache-verification-reconciliation-layout';
import { reconciliationAttempt } from './cache-verification-reconciliation-identity';
import { preservedReconciliationDatabase } from './cache-verification-reconciliation-preserved';
import {
  verifyReconciliationProof,
  type ReconciliationProofReceipt,
} from './cache-verification-reconciliation-producer-proof';
import {
  SIXTH_ARCHIVE as a,
  SIXTH_ARCHIVE_KEY,
  assertSixthOriginal,
  type SixthArchiveOriginal,
} from './cache-archive-sixth-identity';
import {
  archiveDigest,
  sixthSnapshotDigest,
  type SixthArchiveJournal,
} from './cache-archive-sixth-journal';

const baselineSuffix = [
  'verification',
  'cache-reconciliation-5a5f585b-0809-4415-af1c-27b1d9c486d5',
  'postcheck.json',
];
export async function sixthProofReceipts(data: string): Promise<ReconciliationProofReceipt[]> {
  const file = join(data, ...baselineSuffix),
    bytes = (await readCacheFile(data, file, 2 * 1024 ** 2)).data;
  assert.equal(
    reconciliationHash(bytes),
    '515a0085be10ce14937fd609132c209743150b997f5abcba48136561cf1981ab',
  );
  const baseline = JSON.parse(bytes.toString()) as {
    priorProofs: { file: string; bytes: number; sha256: string }[];
  };
  assert.equal(baseline.priorProofs.length, 20);
  const receipts = baseline.priorProofs.map((p) => ({
    path: p.file,
    bytes: p.bytes,
    digest: p.sha256,
  }));
  receipts.push({ path: file, bytes: bytes.length, digest: reconciliationHash(bytes) });
  for (const name of ['proof.json', 'failure-postcheck.json']) {
    const path = join(data, 'verification', `cache-workflow-${a.intent}`, name);
    const value = (await readCacheFile(data, path, 2 * 1024 ** 2)).data;
    receipts.push({ path, bytes: value.length, digest: reconciliationHash(value) });
  }
  for (const receipt of receipts) {
    const child = relative(join(data, 'verification'), receipt.path);
    assert(child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
    await verifyReconciliationProof(data, receipt);
  }
  return receipts;
}
export async function requireSixthSource(db: AppDb, original: SixthArchiveOriginal) {
  const project = await cacheVerificationProject(db);
  assert.equal(project.head, 'f8ecfcf2ac53ebae686e81af7f0a7af12948224d');
  const input = await readManagedPnpmInput(join(project.root, scope.dependencies));
  assert.equal(pnpmInputVersion(input), original.stageResource.source!.dataVersion);
  const source = await lstat(project.root);
  assert.equal(
    reconciliationHash(JSON.stringify([source.dev, source.ino, source.birthtimeMs])),
    original.sourceResource.source!.dataVersion,
  );
  await requireNativeAbsence(reconciliationAttempt(original));
  await project.requireCurrent();
}
/** Read-only host selection. Actual unknown contents are preserved, never relabelled as SDK-created. */
export async function readSixthArchivePlan(
  db: AppDb,
  data: string,
  progress: (phase: string) => void = () => undefined,
): Promise<SixthArchiveJournal> {
  const createdAt = Date.now(),
    store = new ManagedCacheStore(db, data);
  const entries = store.artifacts();
  assert.equal(entries.filter((e) => e.projectId === scope.projectId).length, 1);
  const entry = entries.find((e) => e.key === a.key)!;
  assert(entry);
  const sourceLease = db.admission.get(scope.projectId, a.sourceLeaseId)!;
  const dependenciesLease = db.admission.get(scope.projectId, a.dependencyLeaseId)!;
  assert(sourceLease && dependenciesLease);
  const stageLock = dependenciesLease.locks.find((lock) => lock.mode === 'exclusive')!;
  assert(stageLock);
  const original: SixthArchiveOriginal = {
    entry,
    resource: db.resources.get(a.artifactId)!,
    stageResource: db.resources.get(stageLock.resourceId)!,
    sourceResource: db.resources.get(a.sourceId)!,
    sourceLease,
    dependenciesLease,
    stageFence: db.resources.cleanup.read(stageLock.resourceId)!,
    outcomes: db.resources.outcomes(a.artifactId, 1000),
  };
  assertSixthOriginal(original, store.root);
  await requireSixthSource(db, original);
  progress('archive-check-original-input-and-cas');
  const sourceInput = await readManagedPnpmInput(join(scope.root, scope.dependencies));
  const stageInput = await readManagedPnpmInput(original.stageResource.identity.path!);
  assert.equal(pnpmInputVersion(sourceInput), pnpmInputVersion(stageInput));
  assert.equal((await cacheTree(store.root, store.path(a.key))).digest, a.digest);
  const producerPath = join(data, 'verification', `cache-workflow-${a.intent}`, 'proof.json');
  const producerBytes = (await readCacheFile(data, producerPath, 2 * 1024 ** 2)).data;
  assert.equal(reconciliationHash(producerBytes), a.producerDigest);
  const producer = JSON.parse(producerBytes.toString());
  assert.equal(producer.intentId, a.intent);
  assert.equal(producer.projectId, scope.projectId);
  assert.equal(producer.passed, false);
  assert.match(producer.error, /^Error: managed_pnpm_target_identity_changed\n/);
  assert.deepEqual(producer.finalLeases, [sourceLease, dependenciesLease]);
  assert.deepEqual(producer.protectedBefore, producer.protectedAfter);
  assert.deepEqual(producer.foreignBefore, producer.foreignAfter);
  assert.equal(producer.projectStateBefore, producer.projectStateAfter);
  const roots = {
    artifact: store.path(a.key),
    scratch: join(store.root, 'scratch', `${a.key}-1-original-lock-proof`),
    stage: original.stageResource.identity.path!,
  };
  progress('archive-snapshot-all-retained-originals');
  const snapshot = await snapshotArchiveSources(roots);
  const filesystem = await statfs(data),
    device = (await lstat(data, { bigint: true })).dev.toString();
  assert(
    Number.isSafeInteger(filesystem.bsize) && filesystem.bsize > 0 && filesystem.bsize <= 65536,
  );
  // Conservative allocation rounding + directory metadata, plus bounded journal/proof slack.
  const allocation = archiveAllocation(db, snapshot);
  assert(allocation.reserveBytes <= a.diskBytes, 'Archive exceeds owner-approved reservation');
  const proofs = await sixthProofReceipts(data);
  const preserved = {
    ...preservedReconciliationDatabase(db, entries, original, [], SIXTH_ARCHIVE_KEY),
    proofs,
  };
  assert(
    preserved.leases.every((l) => ['released', 'cancelled', 'stopped_by_owner'].includes(l.state)),
  );
  const journal: SixthArchiveJournal = {
    version: 'owner-archive-before-delete-v1',
    approval: a.approval,
    createdAt,
    project: {
      projectId: scope.projectId,
      root: scope.root,
      head: 'f8ecfcf2ac53ebae686e81af7f0a7af12948224d',
    },
    original,
    roots,
    snapshot,
    producerProof: { path: producerPath, bytes: producerBytes.length, digest: a.producerDigest },
    preserved,
    diskDevice: device,
    allocationUnit: filesystem.bsize,
    allocationBytes: allocation.reserveBytes,
    allocation,
    archiveId: randomUUID(),
    databaseIdentity: db.verificationArchives.databaseIdentity,
    snapshotDigest: '',
    state: 'planned',
    preparations: [],
    sessions: [],
  };
  journal.snapshotDigest = sixthSnapshotDigest(journal);
  progress('archive-revalidate-snapshot-and-preserved-evidence');
  await requireSixthSource(db, original);
  assert.equal(manifestText(await snapshotArchiveSources(roots)), manifestText(snapshot));
  assert.equal(
    archiveDigest(
      preservedReconciliationDatabase(db, store.artifacts(), original, [], SIXTH_ARCHIVE_KEY),
    ),
    archiveDigest({ ...preserved, proofs: undefined }),
  );
  return journal;
}
