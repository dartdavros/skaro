import { isDeepStrictEqual } from 'node:util';
import type { ManagedArtifact } from '../managed-cache-store';
import { RECONCILIATION_UNIQUE_POLICY } from './cache-verification-reconciliation-unique';
import { CACHE_VERIFICATION_OWNER_SCOPE } from './cache-verification-scope';

/** Exact fourth failed publication; never a selector for future command profiles/publications. */
export const RECONCILIATION_INITIALIZED_ATTEMPT = Object.freeze({
  intentId: '4184d324-e8da-4846-acd6-9fcfb380a85b',
  key: 'f56b9b44195084b524ee980830e707327955dff6ce4f838ecdd33589db805aae',
  generation: 1,
  bytes: 25433204,
  expandedBytes: 9468521,
  expandedFiles: 1925,
  sourceLeaseId: '09450e5e-7ff8-4ddb-bf8e-5cf978e72002',
  dependenciesLeaseId: 'cb13c480-5f2c-4c03-b0aa-58f121e8c4cb',
  leaseRevision: 3,
  pid: 4612,
  birth: '639301082444230117',
  tarballs: 52,
  graphBytes: 6194,
  graphDigest: '5a2d7c86f63c7495c3f80c5efe08fec24242bf31c7c04ab29e81095b96e90417',
  producerDigest: '7212115ac35b1f00eb1f079e769842eeb5c5970257def98510dc1c1167e605ec',
});
export const RECONCILIATION_INITIALIZED_PHASE =
  'all-public-downloads-trusted-graph-exact-empty-store-sdk-closed';

/** Exact fifth/config-v3 failure, NOT admission for future publications using any newer profile. */
export const RECONCILIATION_INITIALIZED_V3_ATTEMPT = Object.freeze({
  ...RECONCILIATION_INITIALIZED_ATTEMPT,
  intentId: 'b407c6df-bf21-4c8b-b364-39fd95eb2180',
  key: 'a69b5a56a69a44f5490356be30d9d5de0c1fa7aa9b961aa46449d2f526846635',
  sourceLeaseId: 'b7c4a358-7ad7-470d-837d-276b5292c11b',
  dependenciesLeaseId: '7e854f0e-5822-4bdd-b341-482cecf3654d',
  pid: 12128,
  birth: '639301111934308056',
  producerDigest: '8b8440c887e91d1f04b87e92a3c8755fe068448c171282f61a26abaeae9cda99',
});
export const RECONCILIATION_INITIALIZED_V3_PHASE =
  'all-public-downloads-trusted-graph-exact-empty-store-config-v3-sdk-closed';
const knownInitializedRecoveries = Object.freeze([
  Object.freeze({
    attempt: RECONCILIATION_INITIALIZED_ATTEMPT,
    phase: RECONCILIATION_INITIALIZED_PHASE,
    failure: 'fetch-empty-store' as const,
  }),
  Object.freeze({
    attempt: RECONCILIATION_INITIALIZED_V3_ATTEMPT,
    phase: RECONCILIATION_INITIALIZED_V3_PHASE,
    failure: 'fetch-config-v3-empty-store' as const,
  }),
]);
export type InitializedReconciliationFailure =
  (typeof knownInitializedRecoveries)[number]['failure'];
export const initializedReconciliationIntent = (intent: unknown) =>
  knownInitializedRecoveries.find(({ attempt }) => attempt.intentId === intent);

/** Routing by EITHER marker must force exact descriptor validation; cross-case pairs never fallback. */
export function initializedReconciliationCandidate(
  entry: Pick<ManagedArtifact, 'key' | 'consumer'>,
) {
  return knownInitializedRecoveries.some(
    ({ attempt }) => entry.key === attempt.key || entry.consumer?.intent === attempt.intentId,
  );
}
export function initializedReconciliationDescriptor(
  entry: Pick<ManagedArtifact, 'key' | 'consumer'>,
) {
  return knownInitializedRecoveries.find(
    ({ attempt }) => entry.key === attempt.key && entry.consumer?.intent === attempt.intentId,
  );
}
export const initializedReconciliationPhaseCandidate = (phase: string) =>
  knownInitializedRecoveries.some((descriptor) => descriptor.phase === phase);
export function validInitializedReconciliationEntry(entry: Readonly<ManagedArtifact>) {
  const a = initializedReconciliationDescriptor(entry)?.attempt;
  return (
    !!a &&
    entry.key === a.key &&
    entry.generation === a.generation &&
    entry.manager === 'pnpm' &&
    entry.projectId === CACHE_VERIFICATION_OWNER_SCOPE.projectId &&
    entry.expansionPolicy === RECONCILIATION_UNIQUE_POLICY &&
    entry.bytes === a.bytes &&
    entry.expandedBytes === a.expandedBytes &&
    entry.expandedFiles === a.expandedFiles &&
    entry.state === 'retained' &&
    entry.immutable === false &&
    entry.digest === undefined &&
    isDeepStrictEqual(entry.consumer, { intent: a.intentId, pid: a.pid, birth: a.birth })
  );
}

/** Lease metadata classification only; retained state, authority and native closure remain separate gates. */
export function validInitializedReconciliationReservations(
  entry: Pick<ManagedArtifact, 'key' | 'consumer'>,
  source: { id: string; revision: number },
  dependencies: { id: string; revision: number },
) {
  const a = initializedReconciliationDescriptor(entry)?.attempt;
  return (
    !!a &&
    source.id === a.sourceLeaseId &&
    dependencies.id === a.dependenciesLeaseId &&
    source.revision === a.leaseRevision &&
    dependencies.revision === a.leaseRevision
  );
}

/** Decoder metadata classification only. The live preflight must independently regenerate graph bytes. */
export function validInitializedReconciliationPhase(
  version: number,
  phase: string,
  producerDigest: string | undefined,
  intentId: string = RECONCILIATION_INITIALIZED_ATTEMPT.intentId,
) {
  const descriptor = initializedReconciliationIntent(intentId);
  return (
    !!descriptor &&
    version === 2 &&
    phase === descriptor.phase &&
    producerDigest === descriptor.attempt.producerDigest
  );
}
export function validInitializedReconciliationGraph(
  file: { path: string; bytes: number; digest: string } | undefined,
  intentId: string = RECONCILIATION_INITIALIZED_ATTEMPT.intentId,
) {
  const a = initializedReconciliationIntent(intentId)?.attempt;
  return (
    !!a &&
    file?.path === 'pnpm-graph.json' &&
    file.bytes === a.graphBytes &&
    file.digest === a.graphDigest
  );
}

// Initialized CAS directories only. Empty files/index buckets do NOT prove fetch was not dispatched.
export const INITIALIZED_STORE_DIRECTORIES: readonly string[] = Object.freeze(
  [
    'store',
    'store/v10',
    ...['files', 'index'].flatMap((kind) => [
      `store/v10/${kind}`,
      ...Array.from(
        { length: 256 },
        (_, index) => `store/v10/${kind}/${index.toString(16).padStart(2, '0')}`,
      ),
    ]),
  ].sort(),
);
export function validInitializedStoreDirectories(directories: readonly string[]) {
  return isDeepStrictEqual(
    directories.filter((path) => path === 'store' || path.startsWith('store/')),
    INITIALIZED_STORE_DIRECTORIES,
  );
}
