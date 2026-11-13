import type { ResourceLease, ResourceLeaseRequest } from '@skaro/core';
import { dirname, join, resolve } from 'node:path';
import { hasCacheControls } from '../managed-cache-files';
import { CACHE_VERIFICATION_OWNER_SCOPE as scope } from './cache-verification-scope';
import { reconciliationHash } from './cache-verification-reconciliation-layout';
import {
  assertReplayTree,
  assertReplayOriginalInputs,
} from './cache-verification-reconciliation-replay-physical';
import { assertReplayOriginal } from './cache-verification-reconciliation-replay-original';
import {
  uniqueReconciliationEntry,
  RECONCILIATION_UNIQUE_PHASE,
} from './cache-verification-reconciliation-unique';
import { reconciliationAttempt } from './cache-verification-reconciliation-identity';
import {
  initializedReconciliationCandidate,
  initializedReconciliationDescriptor,
} from './cache-verification-reconciliation-initialized';
import { assertReconciliationV2Evidence } from './cache-verification-reconciliation-replay-v2';
import {
  assertReplayController,
  assertReplayControlRequest,
  replayLeaseRequest,
  replayEqual,
} from './cache-verification-reconciliation-replay-lease';
import {
  replayFail as fail,
  replayKeys,
  replayInteger,
  replayHash,
  RECONCILIATION_JOURNAL_BYTE_LIMIT,
  RECONCILIATION_SESSION_LIMIT,
  type CacheReconciliationJournal,
} from './cache-verification-reconciliation-replay-types';

export const replaySnapshotDigest = (journal: CacheReconciliationJournal) =>
  reconciliationHash(
    JSON.stringify({
      storeRoot: journal.storeRoot,
      ...(journal.version === 2
        ? { producerProof: journal.producerProof, preserved: journal.preserved }
        : {}),
      project: journal.project,
      original: journal.original,
      trees: journal.trees,
      evidence: journal.evidence,
    }),
  );
/** Stored state is a bounded scoped inventory/receipt, never an admission grant or worker approval. */
export function assertReplayJournal(value: unknown): asserts value is CacheReconciliationJournal {
  const encoded = JSON.stringify(value);
  if (!encoded || Buffer.byteLength(encoded) > RECONCILIATION_JOURNAL_BYTE_LIMIT)
    fail('journal_size');
  replayKeys(value, [
    'version',
    'state',
    'createdAt',
    'storeRoot',
    'project',
    'original',
    'trees',
    'evidence',
    'preparations',
    'sessions',
    'snapshotDigest',
    'producerProof',
    'preserved',
  ]);
  const journal = value as CacheReconciliationJournal;
  if (![1, 2].includes(journal.version) || !['pending', 'complete'].includes(journal.state))
    fail('journal_version');
  replayInteger(journal.createdAt, 1);
  replayHash(journal.snapshotDigest);
  if (
    typeof journal.storeRoot !== 'string' ||
    resolve(journal.storeRoot) !== journal.storeRoot ||
    journal.storeRoot !== resolve(dirname(journal.storeRoot), 'managed-caches-v1')
  )
    fail('store_root');
  replayKeys(journal.project, ['projectId', 'root', 'head']);
  if (
    journal.project.projectId !== scope.projectId ||
    journal.project.root !== resolve(scope.root) ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(journal.project.head)
  )
    fail('project_scope');
  assertReplayOriginal(journal);
  const attempt = reconciliationAttempt(journal.original);
  assertReconciliationV2Evidence(journal);
  replayKeys(journal.trees, ['artifact', 'stage', 'scratch']);
  assertReplayTree(journal.trees.artifact, join(journal.storeRoot, 'dependencies', attempt.key));
  assertReplayTree(
    journal.trees.stage,
    join(journal.storeRoot, 'verification-inputs', attempt.inputDirectory),
  );
  assertReplayTree(
    journal.trees.scratch,
    join(journal.storeRoot, 'scratch', `${attempt.key}-publish`),
  );
  assertReplayOriginalInputs(journal, attempt.inputVersion);
  replayKeys(journal.evidence, [
    'phase',
    'originalInputVersion',
    'downloadedTarballs',
    'journaledBytes',
    'physicalBytes',
    'unjournaledDownloadBytes',
    'accounting',
  ]);
  const evidence = journal.evidence;
  if (
    evidence.phase !==
      (initializedReconciliationCandidate(journal.original.entry)
        ? initializedReconciliationDescriptor(journal.original.entry)?.phase
        : uniqueReconciliationEntry(journal.original.entry)
          ? RECONCILIATION_UNIQUE_PHASE
          : 'public-downloads-only-packaged-version-child-closed') ||
    evidence.originalInputVersion !== attempt.inputVersion ||
    !Array.isArray(evidence.downloadedTarballs) ||
    !evidence.downloadedTarballs.length ||
    evidence.downloadedTarballs.length > 4096 ||
    !evidence.downloadedTarballs.every(
      (hash) => typeof hash === 'string' && /^[a-f0-9]{128}$/.test(hash),
    ) ||
    new Set(evidence.downloadedTarballs).size !== evidence.downloadedTarballs.length ||
    evidence.journaledBytes !== journal.original.entry.bytes ||
    evidence.physicalBytes !== journal.trees.artifact.bytes ||
    evidence.unjournaledDownloadBytes !== evidence.physicalBytes - evidence.journaledBytes
  )
    fail('original_download_phase');
  const downloaded = journal.trees.artifact.files.filter((file) =>
    file.path.startsWith('tarballs/'),
  );
  if (
    downloaded.length !== evidence.downloadedTarballs.length ||
    downloaded.some(
      (file) => !evidence.downloadedTarballs.some((hex) => file.path === `tarballs/${hex}.tgz`),
    )
  )
    fail('original_download_inventory');
  const final = downloaded.find(
    (file) => file.path === `tarballs/${evidence.downloadedTarballs.at(-1)}.tgz`,
  );
  if (evidence.unjournaledDownloadBytes !== 0 && evidence.unjournaledDownloadBytes !== final?.bytes)
    fail('original_inflight_download');
  if (
    !Array.isArray(journal.preparations) ||
    journal.preparations.length > RECONCILIATION_SESSION_LIMIT
  )
    fail('preparations');
  const preparedIds = new Set<string>();
  for (const preparation of journal.preparations) {
    replayKeys(preparation, ['request', 'pid', 'birth', 'recordedAt']);
    assertReplayControlRequest(
      preparation.request as ResourceLeaseRequest,
      journal.original.sourceResource,
      attempt.intentId,
    );
    replayInteger(preparation.pid, 1);
    replayInteger(preparation.recordedAt, journal.createdAt);
    if (
      typeof preparation.birth !== 'string' ||
      !preparation.birth ||
      preparation.birth.length > 256 ||
      hasCacheControls(preparation.birth) ||
      preparation.pid === attempt.pid ||
      preparation.request.id === attempt.sourceLeaseId ||
      preparation.request.id === attempt.dependenciesLeaseId ||
      preparedIds.has(preparation.request.id)
    )
      fail('preparation_identity');
    preparedIds.add(preparation.request.id);
  }
  if (!Array.isArray(journal.sessions) || journal.sessions.length > RECONCILIATION_SESSION_LIMIT)
    fail('sessions');
  const sessionIds = new Set<string>();
  for (const session of journal.sessions) {
    replayKeys(session, ['controller', 'pid', 'birth', 'recordedAt']);
    assertReplayController(session.controller as ResourceLease, journal);
    replayInteger(session.pid, 1);
    replayInteger(session.recordedAt, journal.createdAt);
    if (
      session.controller.state !== 'granted' ||
      session.recordedAt < session.controller.createdAt ||
      typeof session.birth !== 'string' ||
      !session.birth ||
      session.birth.length > 256 ||
      hasCacheControls(session.birth) ||
      sessionIds.has(session.controller.id) ||
      session.pid === attempt.pid
    )
      fail('session_identity');
    const prepared = journal.preparations.find((item) => item.request.id === session.controller.id);
    if (
      !prepared ||
      prepared.pid !== session.pid ||
      prepared.birth !== session.birth ||
      prepared.recordedAt > session.controller.createdAt
    )
      fail('unprepared_session');
    replayEqual(
      prepared!.request,
      replayLeaseRequest(session.controller as ResourceLease),
      'prepared_request_changed',
    );
    sessionIds.add(session.controller.id);
  }
  if (journal.snapshotDigest !== replaySnapshotDigest(journal)) fail('snapshot_digest');
}
