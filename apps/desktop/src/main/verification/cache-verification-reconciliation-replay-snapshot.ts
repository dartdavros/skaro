import type { CacheReconciliationPlan } from './cache-verification-reconciliation-plan';
import { replaySnapshotDigest } from './cache-verification-reconciliation-replay-schema';
import type { ReconciliationJournalData } from './cache-verification-reconciliation-replay-types';

/** Serialization only, never authority. Creation separately re-reads the positive original plan. */
export function snapshotReplayPlan(
  plan: Pick<
    CacheReconciliationPlan,
    | 'entry'
    | 'resource'
    | 'stageResource'
    | 'sourceResource'
    | 'sourceLease'
    | 'dependenciesLease'
    | 'stageFence'
    | 'outcomes'
    | 'producerProof'
    | 'preserved'
    | 'storeRoot'
    | 'trees'
  > & {
    project: Pick<CacheReconciliationPlan['project'], 'projectId' | 'root' | 'head'>;
  },
): ReconciliationJournalData {
  const {
    entry,
    resource,
    stageResource,
    sourceResource,
    sourceLease,
    dependenciesLease,
    stageFence,
    outcomes,
  } = plan;
  const journal: ReconciliationJournalData = {
    version: 2,
    producerProof: plan.producerProof,
    preserved: plan.preserved,
    state: 'pending',
    createdAt: Date.now(),
    storeRoot: plan.storeRoot,
    project: {
      projectId: plan.project.projectId,
      root: plan.project.root,
      head: plan.project.head,
    },
    original: {
      entry,
      resource,
      stageResource,
      sourceResource,
      sourceLease,
      dependenciesLease,
      stageFence,
      outcomes,
    },
    trees: { artifact: plan.trees.artifact, stage: plan.trees.stage, scratch: plan.trees.scratch },
    evidence: {
      accounting: plan.trees.accounting,
      phase: plan.trees.phase,
      originalInputVersion: plan.trees.originalInputVersion,
      downloadedTarballs: plan.trees.downloadedTarballs,
      journaledBytes: plan.trees.journaledBytes,
      physicalBytes: plan.trees.physicalBytes,
      unjournaledDownloadBytes: plan.trees.unjournaledDownloadBytes,
    },
    preparations: [],
    sessions: [],
    snapshotDigest: '',
  };
  journal.snapshotDigest = replaySnapshotDigest(journal);
  return JSON.parse(JSON.stringify(journal));
}
