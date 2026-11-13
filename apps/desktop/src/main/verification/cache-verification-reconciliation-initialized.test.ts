import { expect, it } from 'vitest';
import type { ManagedArtifact } from '../managed-cache-store';
import {
  initializedReconciliationCandidate,
  validInitializedReconciliationEntry,
  validInitializedReconciliationPhase,
  validInitializedReconciliationGraph,
  validInitializedStoreDirectories,
  INITIALIZED_STORE_DIRECTORIES,
  RECONCILIATION_INITIALIZED_ATTEMPT as attempt,
  RECONCILIATION_INITIALIZED_PHASE,
} from './cache-verification-reconciliation-initialized';
import { initializedReconciliationProducerFailure } from './cache-verification-reconciliation-initialized-proof';
import { uniqueReconciliationProducerFailure } from './cache-verification-reconciliation-unique-proof';
import { RECONCILIATION_UNIQUE_PHASE } from './cache-verification-reconciliation-unique';
import { completeReconciliationAccounting } from './cache-verification-reconciliation-unique-accounting';

// Pure metadata classification/arithmetic only; no invented archive/tree/executor/grant or filesystem.
const metadata: ManagedArtifact = {
  manager: 'pnpm',
  expansionPolicy: 'pnpm-isolated-unique-nodes-v2',
  key: attempt.key,
  projectId: 'b1a0a1fc-5435-4b37-a30a-c2b3d6c06f1b',
  resourceId: '', // Deliberately NOT a domain receipt; ledger/native validators must independently bind it.
  generation: attempt.generation,
  state: 'retained',
  bytes: attempt.bytes,
  expandedBytes: attempt.expandedBytes,
  expandedFiles: attempt.expandedFiles,
  immutable: false,
  usedAt: 0,
  consumer: { intent: attempt.intentId, pid: attempt.pid, birth: attempt.birth },
};

it('routes either exact marker to a narrow fourth-attempt classifier, never another publication', () => {
  expect(initializedReconciliationCandidate(metadata)).toBe(true);
  expect(validInitializedReconciliationEntry(metadata)).toBe(true);
  for (const change of [
    { key: '0'.repeat(64) },
    { generation: 2 },
    { projectId: 'foreign' },
    { bytes: attempt.bytes - attempt.graphBytes },
    { expandedBytes: attempt.expandedBytes + 1 },
    { expandedFiles: attempt.expandedFiles - 1 },
    { manager: 'npm' as const },
    { expansionPolicy: undefined },
    { state: 'ready' as const },
    { immutable: true },
    { digest: '0'.repeat(64) },
    { consumer: { ...metadata.consumer!, intent: 'a316594d-37b4-4863-b107-ac40437ac9a9' } },
    { consumer: { ...metadata.consumer!, pid: attempt.pid + 1 } },
    { consumer: { ...metadata.consumer!, birth: '639301082444230118' } },
  ])
    expect(validInitializedReconciliationEntry({ ...metadata, ...change })).toBe(false);
  expect(initializedReconciliationCandidate({ ...metadata, key: '0'.repeat(64) })).toBe(true);
  expect(initializedReconciliationCandidate({ ...metadata, consumer: undefined })).toBe(true);
  expect(initializedReconciliationCandidate({ key: '0'.repeat(64) })).toBe(false);
  expect(RECONCILIATION_INITIALIZED_PHASE).not.toBe(RECONCILIATION_UNIQUE_PHASE);
});

it('binds the new decoder tag to its exact producer and graph metadata, never an arbitrary digest', () => {
  const phase = (
    version = 2,
    tag: string = RECONCILIATION_INITIALIZED_PHASE,
    digest: string = attempt.producerDigest,
  ) => validInitializedReconciliationPhase(version, tag, digest);
  expect(phase()).toBe(true);
  expect(phase(1)).toBe(false);
  expect(phase(2, RECONCILIATION_UNIQUE_PHASE)).toBe(false);
  expect(phase(2, `${RECONCILIATION_INITIALIZED_PHASE}-other`)).toBe(false);
  expect(phase(2, RECONCILIATION_INITIALIZED_PHASE, '0'.repeat(64))).toBe(false);
  const graph = { path: 'pnpm-graph.json', bytes: attempt.graphBytes, digest: attempt.graphDigest };
  expect(validInitializedReconciliationGraph(graph)).toBe(true);
  expect(validInitializedReconciliationGraph(undefined)).toBe(false);
  expect(validInitializedReconciliationGraph({ ...graph, digest: '0'.repeat(64) })).toBe(false);
  expect(validInitializedReconciliationGraph({ ...graph, bytes: graph.bytes + 1 })).toBe(false);
  expect(validInitializedReconciliationGraph({ ...graph, path: 'runtime/pnpm-graph.json' })).toBe(
    false,
  );
});

it('requires the exact complete sorted empty-store directory namespace, not a prefix or subset', () => {
  const directories = INITIALIZED_STORE_DIRECTORIES;
  expect(directories).toHaveLength(516); // store root plus 515 v10/files/index directories.
  expect(directories.filter((path) => /^store\/v10\/files\/[a-f0-9]{2}$/.test(path))).toHaveLength(
    256,
  );
  expect(directories.filter((path) => /^store\/v10\/index\/[a-f0-9]{2}$/.test(path))).toHaveLength(
    256,
  );
  expect(validInitializedStoreDirectories(directories)).toBe(true);
  for (const changed of [
    directories.slice(1),
    directories.filter((path) => path !== 'store/v10/index/ff'),
    [...directories, 'store/v10/files/00/unknown'].sort(),
    [...directories, 'store/v11'].sort(),
    [...directories, 'store/unknown'].sort(),
    [...directories, 'store/v10/files/00'].sort(),
    directories.map((path) => path.replace('/ff', '/FF')).sort(),
  ])
    expect(validInitializedStoreDirectories(changed)).toBe(false);
});

it('never labels incomplete planner counters as complete archive accounting', () => {
  // Numeric planner metadata only, NOT fabricated archive facts or a publication receipt.
  const counters = {
    complete: true,
    missingPackageIds: [] as string[],
    expandedBytes: 9468521,
    nodes: 1925,
    payloadBytes: 8878697,
    shimFiles: 9,
    shimBytes: 589824,
    metadataFiles: 3,
  };
  expect(completeReconciliationAccounting(metadata, 52, counters).completedTarballs).toBe(52);
  expect(() =>
    completeReconciliationAccounting(metadata, 52, { ...counters, complete: false }),
  ).toThrow('unique_incomplete_archives');
  expect(() =>
    completeReconciliationAccounting(metadata, 52, { ...counters, missingPackageIds: ['missing'] }),
  ).toThrow('unique_incomplete_archives');
  expect(() =>
    completeReconciliationAccounting(metadata, 52, { ...counters, nodes: 1924 }),
  ).toThrow('unique_counters_changed');
});

it('classifies only the exact fetch-error envelope and never upgrades the historical generic seam', () => {
  const envelope = {
    intentId: attempt.intentId,
    error: 'Error: managed_pnpm_fetch_failed_exit_1_unreported\n',
    dependencyOperations: [],
  };
  expect(initializedReconciliationProducerFailure(envelope)).toBe('fetch-empty-store');
  expect(() => uniqueReconciliationProducerFailure(envelope)).toThrow(
    'unique_failed_producer_proof',
  );
  for (const change of [
    { intentId: 'a316594d-37b4-4863-b107-ac40437ac9a9' },
    { error: 'Error: managed_cache_command_failed\n' },
    { error: 'Error: managed_pnpm_install_failed_exit_1_unreported\n' },
    { error: 'Error: managed_pnpm_fetch_failed_exit_1_unreported_extra\n' },
    { error: 'Error: managed_pnpm_fetch_failed_exit_1_unreported' },
    { dependencyOperations: undefined, operations: [] },
    { dependencyOperations: ['completed'] },
  ])
    expect(() => initializedReconciliationProducerFailure({ ...envelope, ...change })).toThrow(
      'initialized_failed_producer_proof',
    );
});
