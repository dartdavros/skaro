import { expect, it } from 'vitest';
import type { ManagedArtifact } from '../managed-cache-store';
import {
  RECONCILIATION_INITIALIZED_ATTEMPT as fourth,
  RECONCILIATION_INITIALIZED_V3_ATTEMPT as fifth,
  RECONCILIATION_INITIALIZED_PHASE as fourthPhase,
  RECONCILIATION_INITIALIZED_V3_PHASE as fifthPhase,
  initializedReconciliationCandidate,
  initializedReconciliationDescriptor,
  initializedReconciliationIntent,
  initializedReconciliationPhaseCandidate,
  validInitializedReconciliationEntry,
  validInitializedReconciliationPhase,
  validInitializedReconciliationReservations,
  validInitializedReconciliationGraph,
} from './cache-verification-reconciliation-initialized';
import { initializedReconciliationProducerFailure } from './cache-verification-reconciliation-initialized-proof';
import { uniqueReconciliationProducerFailure } from './cache-verification-reconciliation-unique-proof';

// Pure known metadata only, deliberately incomplete domain identity: no fixture trees/receipts/grants.
function metadata(a: typeof fourth | typeof fifth): ManagedArtifact {
  return {
    manager: 'pnpm',
    expansionPolicy: 'pnpm-isolated-unique-nodes-v2',
    key: a.key,
    projectId: 'b1a0a1fc-5435-4b37-a30a-c2b3d6c06f1b',
    resourceId: '',
    generation: a.generation,
    state: 'retained',
    bytes: a.bytes,
    expandedBytes: a.expandedBytes,
    expandedFiles: a.expandedFiles,
    immutable: false,
    usedAt: 0,
    consumer: { intent: a.intentId, pid: a.pid, birth: a.birth },
  };
}
const cases = [
  { attempt: fourth, phase: fourthPhase, failure: 'fetch-empty-store' },
  { attempt: fifth, phase: fifthPhase, failure: 'fetch-config-v3-empty-store' },
];

it('binds exactly two immutable known attempts to distinct phases, never a future generic selector', () => {
  expect(fourthPhase).toBe('all-public-downloads-trusted-graph-exact-empty-store-sdk-closed');
  expect(fifthPhase).not.toBe(fourthPhase);
  for (const { attempt, phase, failure } of cases) {
    const entry = metadata(attempt),
      descriptor = initializedReconciliationDescriptor(entry);
    expect(descriptor?.attempt).toBe(attempt);
    expect(descriptor?.phase).toBe(phase);
    expect(descriptor?.failure).toBe(failure);
    expect(initializedReconciliationIntent(attempt.intentId)).toBe(descriptor);
    expect(validInitializedReconciliationEntry(entry)).toBe(true);
    expect(initializedReconciliationPhaseCandidate(phase)).toBe(true);
  }
  expect(initializedReconciliationIntent('future')).toBeUndefined();
  expect(initializedReconciliationPhaseCandidate(`${fifthPhase}-future`)).toBe(false);
});

it('forces either known marker through exact validation and rejects all cross-case key/intent/consumer mixes', () => {
  for (const attempt of [fourth, fifth]) {
    const other = attempt === fourth ? fifth : fourth,
      entry = metadata(attempt);
    for (const changed of [
      { ...entry, key: other.key },
      { ...entry, consumer: { ...entry.consumer!, intent: other.intentId } },
      { ...entry, key: '0'.repeat(64) },
      { ...entry, consumer: { ...entry.consumer!, intent: 'unknown' } },
    ]) {
      expect(initializedReconciliationCandidate(changed)).toBe(true);
      expect(initializedReconciliationDescriptor(changed)).toBeUndefined();
      expect(validInitializedReconciliationEntry(changed)).toBe(false);
    }
    for (const change of [
      { consumer: { ...entry.consumer!, pid: other.pid } },
      { consumer: { ...entry.consumer!, birth: other.birth } },
      { generation: 2 },
      { bytes: attempt.bytes + 1 },
      { expandedBytes: attempt.expandedBytes - 1 },
      { expandedFiles: attempt.expandedFiles + 1 },
    ])
      expect(validInitializedReconciliationEntry({ ...entry, ...change })).toBe(false);
  }
  expect(
    initializedReconciliationCandidate({ key: '0'.repeat(64), consumer: { intent: 'unknown' } }),
  ).toBe(false);
});

it('never accepts fifth metadata under the fourth tag/default seam or cross-binds their producer receipts', () => {
  for (const { attempt, phase } of cases) {
    const other = attempt === fourth ? fifth : fourth;
    expect(
      validInitializedReconciliationPhase(2, phase, attempt.producerDigest, attempt.intentId),
    ).toBe(true);
    expect(
      validInitializedReconciliationPhase(2, phase, other.producerDigest, attempt.intentId),
    ).toBe(false);
    expect(
      validInitializedReconciliationPhase(2, phase, attempt.producerDigest, other.intentId),
    ).toBe(false);
    expect(
      validInitializedReconciliationPhase(1, phase, attempt.producerDigest, attempt.intentId),
    ).toBe(false);
  }
  expect(validInitializedReconciliationPhase(2, fifthPhase, fifth.producerDigest)).toBe(false);
  expect(validInitializedReconciliationPhase(2, fourthPhase, fourth.producerDigest)).toBe(true);
  expect(validInitializedReconciliationPhase(2, fifthPhase, fifth.producerDigest, 'unknown')).toBe(
    false,
  );
});

it('binds both original reservation IDs and revision3 to the same selected attempt', () => {
  for (const attempt of [fourth, fifth]) {
    const entry = metadata(attempt),
      other = attempt === fourth ? fifth : fourth;
    const source = { id: attempt.sourceLeaseId, revision: 3 };
    const dependencies = { id: attempt.dependenciesLeaseId, revision: 3 };
    expect(validInitializedReconciliationReservations(entry, source, dependencies)).toBe(true);
    expect(
      validInitializedReconciliationReservations(
        entry,
        { ...source, id: other.sourceLeaseId },
        dependencies,
      ),
    ).toBe(false);
    expect(
      validInitializedReconciliationReservations(entry, source, {
        ...dependencies,
        id: other.dependenciesLeaseId,
      }),
    ).toBe(false);
    expect(
      validInitializedReconciliationReservations(entry, { ...source, revision: 4 }, dependencies),
    ).toBe(false);
    expect(
      validInitializedReconciliationReservations(entry, source, { ...dependencies, revision: 2 }),
    ).toBe(false);
    expect(validInitializedReconciliationReservations(entry, dependencies, source)).toBe(false);
  }
});

it('keeps the two exact fetch envelopes distinct without changing the historical generic producer seam', () => {
  for (const { attempt, failure } of cases) {
    const envelope = {
      intentId: attempt.intentId,
      error: 'Error: managed_pnpm_fetch_failed_exit_1_unreported\n',
      dependencyOperations: [],
    };
    expect(initializedReconciliationProducerFailure(envelope)).toBe(failure);
    expect(() => uniqueReconciliationProducerFailure(envelope)).toThrow(
      'unique_failed_producer_proof',
    );
    for (const change of [
      { intentId: 'unknown' },
      { error: 'Error: managed_cache_command_failed\n' },
      { dependencyOperations: ['completed'] },
    ])
      expect(() => initializedReconciliationProducerFailure({ ...envelope, ...change })).toThrow(
        'initialized_failed_producer_proof',
      );
  }
  const graph = { path: 'pnpm-graph.json', bytes: fifth.graphBytes, digest: fifth.graphDigest };
  expect(validInitializedReconciliationGraph(graph, fifth.intentId)).toBe(true);
  expect(validInitializedReconciliationGraph(graph, 'unknown')).toBe(false);
  expect(
    validInitializedReconciliationGraph({ ...graph, digest: '0'.repeat(64) }, fifth.intentId),
  ).toBe(false);
});
