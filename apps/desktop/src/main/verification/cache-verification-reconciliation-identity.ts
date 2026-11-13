import type { ResourceRecord } from '@skaro/core';
import { basename } from 'node:path';
import type { ManagedArtifact } from '../managed-cache-store';

export interface ReconciliationIdentitySource {
  entry: Readonly<ManagedArtifact>;
  resource: Pick<ResourceRecord, 'id' | 'generation'>;
  stageResource: Pick<ResourceRecord, 'id' | 'generation' | 'identity' | 'source'>;
  sourceResource: Pick<ResourceRecord, 'id' | 'generation'>;
  sourceLease: { id: string };
  dependenciesLease: { id: string };
}
/** Identity is projected from captured host ledger/catalogue facts, never selected by a pathname flag. */
export function reconciliationAttempt(original: ReconciliationIdentitySource) {
  return {
    intentId: original.entry.consumer!.intent,
    key: original.entry.key,
    artifactId: original.resource.id,
    artifactGeneration: original.resource.generation,
    stageId: original.stageResource.id,
    stageGeneration: original.stageResource.generation,
    sourceId: original.sourceResource.id,
    sourceGeneration: original.sourceResource.generation,
    sourceLeaseId: original.sourceLease.id,
    dependenciesLeaseId: original.dependenciesLease.id,
    inputDirectory: basename(original.stageResource.identity.path!),
    inputVersion: original.stageResource.source!.dataVersion!,
    pid: original.entry.consumer!.pid!,
    birth: original.entry.consumer!.birth!,
  };
}
export function requireReconciliationIntent(intent: unknown): asserts intent is string {
  if (typeof intent !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(intent))
    throw new Error('cache_reconciliation_explicit_failed_intent_required');
}
export const sourceReconciliationLock = (source: { id: string; generation: number }) => ({
  resourceId: source.id,
  generation: source.generation,
  mode: 'shared' as const,
});
