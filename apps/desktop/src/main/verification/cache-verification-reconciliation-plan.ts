import type { AppDb } from '@skaro/core';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ManagedCacheStore } from '../managed-cache-store';
import { selectManagedCacheContext } from '../managed-cache-context';
import {
  cacheVerificationProject,
  CACHE_VERIFICATION_OWNER_SCOPE,
} from './cache-verification-scope';
import {
  freezeReconciliation,
  readReconciliationLayout,
  reconciliationHash,
  requireNativeAbsence,
  CACHE_RECONCILIATION_ATTEMPT,
} from './cache-verification-reconciliation-layout';
import { discoverReconciliationSnapshot } from './cache-verification-reconciliation-discovery';
import { readInitializedReconciliationLayout } from './cache-verification-reconciliation-initialized-layout';
import {
  readUniqueReconciliationLayout,
  requireReconciliationSourceInput,
} from './cache-verification-reconciliation-unique-layout';
import {
  readReconciliationProducerProof,
  verifyReconciliationProof,
} from './cache-verification-reconciliation-producer-proof';
import {
  readPriorReconciliationProofs,
  verifyPreservedReconciliationProofs,
} from './cache-verification-reconciliation-preserved';

export { CACHE_RECONCILIATION_ATTEMPT } from './cache-verification-reconciliation-layout';
const equal = (a: unknown, b: unknown, reason: string) => {
  if (!isDeepStrictEqual(a, b)) throw new Error(`cache_reconciliation_${reason}`);
};
/** Read-only positive phase proof, NOT a cleanup grant. Identity comes only from actual scoped host state. */
export async function readCacheReconciliationPlan(
  db: AppDb,
  data: string,
  failedIntent: string = CACHE_RECONCILIATION_ATTEMPT.intentId,
) {
  const observedAt = Date.now(),
    project = await cacheVerificationProject(db);
  const selected = await selectManagedCacheContext(
    project.root,
    CACHE_VERIFICATION_OWNER_SCOPE.dependencies,
  );
  const store = new ManagedCacheStore(db, data);
  const snapshots = () =>
    discoverReconciliationSnapshot(db, store, project, failedIntent, observedAt);
  const snapshot = snapshots(),
    attempt = snapshot.attempt;
  const info = await lstat(project.root);
  equal(
    snapshot.sourceResource.source?.dataVersion,
    reconciliationHash(JSON.stringify([info.dev, info.ino, info.birthtimeMs])),
    'source_native_version_changed',
  );
  const stagePath = join(store.root, 'verification-inputs', attempt.inputDirectory);
  const producer = await readReconciliationProducerProof(data, failedIntent, project, snapshot);
  const priorProofs = await readPriorReconciliationProofs(data);
  await requireNativeAbsence(attempt);
  const readTrees = () => {
    const args = [store, snapshot.entry, stagePath, attempt.inputVersion, selected.cwd] as const;
    if (
      producer.failure === 'fetch-empty-store' ||
      producer.failure === 'fetch-config-v3-empty-store'
    )
      return readInitializedReconciliationLayout(...args, producer.failure);
    if (producer.failure === 'prefetch-command')
      return readUniqueReconciliationLayout(...args, producer.failure);
    return readReconciliationLayout(...args, producer.failure);
  };
  const requireSourceInput = async () => {
    if (
      producer.failure === 'prefetch-command' ||
      producer.failure === 'fetch-empty-store' ||
      producer.failure === 'fetch-config-v3-empty-store'
    )
      await requireReconciliationSourceInput(selected.cwd, attempt.inputVersion);
  };
  const trees = await readTrees();
  async function requireUnchanged() {
    await project.requireCurrent();
    await selected.requireCurrent();
    await requireSourceInput();
    await requireNativeAbsence(attempt);
    equal(snapshots(), snapshot, 'database_snapshot_changed');
    await verifyReconciliationProof(data, producer.receipt);
    await verifyPreservedReconciliationProofs(data, priorProofs);
    equal(await readTrees(), trees, 'physical_snapshot_changed');
    equal(snapshots(), snapshot, 'database_changed_during_physical_read');
    await project.requireCurrent();
    await selected.requireCurrent();
    await requireSourceInput();
    await requireNativeAbsence(attempt);
  }
  await requireUnchanged();
  return freezeReconciliation({
    ...snapshot,
    preserved: { ...snapshot.preserved, proofs: priorProofs },
    producerProof: producer.receipt,
    project,
    observedAt,
    storeRoot: store.root,
    artifact: snapshot.resource,
    stage: snapshot.stageResource,
    source: snapshot.sourceResource,
    dependencyLease: snapshot.dependenciesLease,
    artifactPath: store.path(snapshot.entry.key),
    stagePath,
    scratchPath: trees.scratchPath,
    trees,
    requireUnchanged,
  });
}
export type CacheReconciliationPlan = Awaited<ReturnType<typeof readCacheReconciliationPlan>>;
