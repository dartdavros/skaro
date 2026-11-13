import type { AppDb, ResourceLease, ResourceRecord, ResourceOutcome } from '@skaro/core';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readCacheFile } from '../managed-cache-files';
import type { ManagedArtifact } from '../managed-cache-store';
import {
  reconciliationPriorJournals,
  verifyReconciliationProof,
  type ReconciliationProofReceipt,
} from './cache-verification-reconciliation-producer-proof';
import type { ReconciliationIdentitySource } from './cache-verification-reconciliation-identity';
import { reconciliationAttempt } from './cache-verification-reconciliation-identity';
import { CACHE_VERIFICATION_OWNER_SCOPE as scope } from './cache-verification-scope';

export interface ReconciliationPreserved {
  resources: ResourceRecord[];
  leases: ResourceLease[];
  entries: ManagedArtifact[];
  outcomes: { resourceId: string; values: ResourceOutcome[] }[];
  journals: { key: string; bytes: number; digest: string }[];
  proofs: ReconciliationProofReceipt[];
}
export function preservedReconciliationDatabase(
  db: AppDb,
  entries: ManagedArtifact[],
  original: ReconciliationIdentitySource,
  preparedIds: readonly string[] = [],
  excludingJournalKey?: string,
) {
  const a = reconciliationAttempt(original);
  const targetIds = new Set([a.artifactId, a.stageId, a.sourceId]);
  const resources = db.resources.list(scope.projectId);
  const leases = db.admission
    .all()
    .filter(
      (lease) =>
        lease.projectId === scope.projectId ||
        lease.locks.some((lock) => targetIds.has(lock.resourceId)),
    );
  if (resources.length > 10000 || leases.length > 10000)
    throw new Error('cache_reconciliation_preserved_limit');
  return {
    resources: resources.filter((resource) => !targetIds.has(resource.id)),
    leases: leases.filter(
      (lease) =>
        lease.id !== a.sourceLeaseId &&
        lease.id !== a.dependenciesLeaseId &&
        !preparedIds.includes(lease.id),
    ),
    entries: entries.filter((entry) => entry.key !== a.key),
    outcomes: resources
      .filter((resource) => resource.id !== a.stageId)
      .map((resource) => ({
        resourceId: resource.id,
        values: db.resources
          .outcomes(resource.id, 1000)
          .filter(
            (outcome) =>
              resource.id !== a.artifactId || outcome.generation !== a.artifactGeneration,
          ),
      })),
    journals: reconciliationPriorJournals(db, excludingJournalKey),
  };
}
export async function readPriorReconciliationProofs(data: string) {
  const directory = join(data, 'verification');
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > 512) throw new Error('cache_reconciliation_proof_limit');
  const proofs: ReconciliationProofReceipt[] = [];
  let total = 0;
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!/^cache-reconciliation-[a-f0-9-]{36}$/.test(entry.name)) continue;
    const path = join(directory, entry.name, 'proof.json');
    let bytes: Buffer;
    try {
      bytes = (await readCacheFile(data, path, 8 * 1024 ** 2)).data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    total += bytes.length;
    if (total > 8 * 1024 ** 2 || proofs.length >= 64)
      throw new Error('cache_reconciliation_proof_limit');
    proofs.push({
      path,
      bytes: bytes.length,
      digest: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return proofs;
}
export async function verifyPreservedReconciliationProofs(
  data: string,
  proofs: readonly ReconciliationProofReceipt[],
) {
  for (const proof of proofs) await verifyReconciliationProof(data, proof);
}
