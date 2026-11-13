import type { ManagedArtifact } from '../managed-cache-store';
import { PNPM_GRAPH_FILE } from '../managed-pnpm-graph-facts';
import { RECONCILIATION_UNIQUE_METHOD } from './cache-verification-reconciliation-unique';
import { validUniqueReconciliationAccounting } from './cache-verification-reconciliation-unique-accounting';
import {
  initializedReconciliationCandidate,
  initializedReconciliationDescriptor,
  validInitializedReconciliationEntry,
  validInitializedReconciliationReservations,
  validInitializedReconciliationPhase,
  validInitializedReconciliationGraph,
  validInitializedStoreDirectories,
} from './cache-verification-reconciliation-initialized';
import {
  replayFail as fail,
  replayKeys,
  type CacheReconciliationJournal,
  type ReconciliationTree,
} from './cache-verification-reconciliation-replay-types';

/** Exact static scope, in addition to (never instead of) original retained/native/ledger checks. */
export function assertInitializedReconciliationOriginal(
  original: CacheReconciliationJournal['original'],
) {
  if (!initializedReconciliationCandidate(original.entry)) return;
  if (
    !validInitializedReconciliationEntry(original.entry) ||
    !validInitializedReconciliationReservations(
      original.entry,
      original.sourceLease,
      original.dependenciesLease,
    )
  )
    fail('initialized_original_binding');
}

/** Native inventory separately rejects links/aliases; NO store files or unknown bucket children. */
export function assertInitializedReconciliationArtifact(
  artifact: Pick<ReconciliationTree, 'files' | 'directories' | 'bytes'>,
  entry: Readonly<ManagedArtifact>,
) {
  const graph = artifact.files.filter((file) => file.path === PNPM_GRAPH_FILE),
    attempt = initializedReconciliationDescriptor(entry)?.attempt;
  if (
    !attempt ||
    !validInitializedReconciliationEntry(entry) ||
    artifact.bytes !== attempt.bytes ||
    graph.length !== 1 ||
    !validInitializedReconciliationGraph(graph[0], attempt.intentId) ||
    !artifact.files.some((file) => file.path === 'pnpm.tgz' && file.bytes > 0) ||
    artifact.files.some(
      (file) =>
        file.path !== PNPM_GRAPH_FILE &&
        file.path !== 'pnpm.tgz' &&
        !file.path.startsWith('runtime/') &&
        !/^tarballs\/[a-f0-9]{128}\.tgz$/.test(file.path),
    ) ||
    !validInitializedStoreDirectories(artifact.directories) ||
    artifact.directories.some(
      (path) =>
        !['', 'runtime', 'tarballs', 'store'].includes(path) &&
        !path.startsWith('runtime/') &&
        !path.startsWith('store/'),
    )
  )
    fail('initialized_artifact_shape');
}

/** New tag ONLY. Legacy generic prefetch evidence is deliberately not accepted/extended here. */
export function assertInitializedReconciliationEvidence(journal: CacheReconciliationJournal) {
  const { evidence, original } = journal,
    accounting = evidence.accounting;
  assertInitializedReconciliationOriginal(original);
  const descriptor = initializedReconciliationDescriptor(original.entry);
  if (
    !descriptor ||
    !validInitializedReconciliationPhase(
      journal.version,
      evidence.phase,
      journal.producerProof?.digest,
      descriptor.attempt.intentId,
    ) ||
    !initializedReconciliationCandidate(original.entry) ||
    accounting?.method !== RECONCILIATION_UNIQUE_METHOD
  )
    return fail('initialized_phase_binding');
  const { attempt } = descriptor;
  replayKeys(accounting, [
    'method',
    'complete',
    'completedTarballs',
    'expandedBytes',
    'expandedFiles',
    'payloadBytes',
    'shimFiles',
    'shimBytes',
    'metadataFiles',
  ]);
  if (
    !validUniqueReconciliationAccounting(
      accounting,
      evidence.downloadedTarballs.length,
      evidence.unjournaledDownloadBytes,
    ) ||
    accounting.completedTarballs !== attempt.tarballs ||
    accounting.expandedBytes !== attempt.expandedBytes ||
    accounting.expandedFiles !== attempt.expandedFiles ||
    accounting.payloadBytes !== 8878697 ||
    accounting.shimFiles !== 9 ||
    evidence.physicalBytes !== evidence.journaledBytes
  )
    fail('initialized_complete_accounting');
  assertInitializedReconciliationArtifact(journal.trees.artifact, original.entry);
}
