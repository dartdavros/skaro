import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readCacheFile } from '../managed-cache-files';
import type { ManagedArtifact, ManagedCacheStore } from '../managed-cache-store';
import { readManagedPnpmInput } from '../managed-pnpm-provenance';
import { encodePnpmGraphFacts, PNPM_GRAPH_FILE } from '../managed-pnpm-graph-facts';
import {
  freezeReconciliation,
  pnpmInputVersion,
  reconciliationHash,
  reconciliationInventory,
} from './cache-verification-reconciliation-layout';
import { readReconciliationArchives } from './cache-verification-reconciliation-archives';
import { readReconciliationArchiveFacts } from './cache-verification-reconciliation-archive-facts';
import { completeReconciliationAccounting } from './cache-verification-reconciliation-unique-accounting';
import { assertUniqueReconciliationInputs } from './cache-verification-reconciliation-unique-inputs';
import { requireReconciliationSourceInput } from './cache-verification-reconciliation-unique-layout';
import { validReconciliationPublicationShape } from './cache-verification-reconciliation-unique';
import { requireReconciliationMirror } from './cache-verification-reconciliation-mirror';
import { assertInitializedReconciliationArtifact } from './cache-verification-reconciliation-initialized-evidence';
import {
  initializedReconciliationDescriptor,
  validInitializedReconciliationEntry,
  type InitializedReconciliationFailure,
} from './cache-verification-reconciliation-initialized';

/** Two exact failures only. Initialized empty CAS is NOT proof fetch was never dispatched. */
export async function readInitializedReconciliationLayout(
  store: ManagedCacheStore,
  entry: ManagedArtifact,
  stagePath: string,
  expectedInputVersion: string,
  sourceInputPath: string,
  failure: InitializedReconciliationFailure,
) {
  function fail(reason: string): never {
    throw new Error(`cache_reconciliation_initialized_${reason}`);
  }
  const descriptor = initializedReconciliationDescriptor(entry);
  if (
    !descriptor ||
    failure !== descriptor.failure ||
    !validInitializedReconciliationEntry(entry) ||
    !validReconciliationPublicationShape(entry, 2, store.root)
  )
    fail('publication_required');
  const { attempt } = descriptor;
  const requireSource = () =>
    requireReconciliationSourceInput(sourceInputPath, expectedInputVersion);
  await requireSource();
  const input = await readManagedPnpmInput(stagePath);
  if (pnpmInputVersion(input) !== expectedInputVersion) fail('original_stage_digest_changed');
  const path = store.path(entry.key),
    scratchPath = join(store.root, 'scratch', `${entry.key}-publish`);
  const stage = await reconciliationInventory(store.root, stagePath),
    artifact = await reconciliationInventory(store.root, path),
    scratch = await reconciliationInventory(store.root, scratchPath);
  assertUniqueReconciliationInputs(entry, stage, scratch);
  assertInitializedReconciliationArtifact(artifact, entry);
  // Validate ONLY the two explicitly admitted additions before projecting the unchanged archive seam.
  // The generic prefetch validator continues to reject these files/directories outright.
  const { lockedTarballs, downloaded, prefix } = await readReconciliationArchives(
    store.root,
    path,
    {
      ...artifact,
      files: artifact.files.filter((file) => file.path !== PNPM_GRAPH_FILE),
      directories: artifact.directories.filter(
        (directory) => directory !== 'store' && !directory.startsWith('store/'),
      ),
    },
    input.lock,
  );
  if (
    downloaded.length !== attempt.tarballs ||
    downloaded.length !== lockedTarballs.length ||
    artifact.bytes !== entry.bytes
  )
    fail('all_downloads_journaled_required');
  await requireReconciliationMirror(store.root, path, scratchPath, input);
  const { complete, graphFacts } = await readReconciliationArchiveFacts(
    store.root,
    path,
    input.lock,
  );
  const accounting = completeReconciliationAccounting(entry, lockedTarballs.length, complete);
  // Reproduce publisher insertion order/encoding from EVERY integrity-verified original archive.
  // Parsing a sidecar or accepting its stored digest would not establish archive-derived authority.
  const regenerated = encodePnpmGraphFacts(input.lock, graphFacts),
    graph = await readCacheFile(store.root, join(path, PNPM_GRAPH_FILE), 16 * 1024 ** 2),
    recorded = artifact.files.find((file) => file.path === PNPM_GRAPH_FILE)!;
  if (
    regenerated.length !== attempt.graphBytes ||
    !graph.data.equals(regenerated) ||
    reconciliationHash(regenerated) !== recorded.digest
  )
    fail('trusted_graph_changed');
  for (const [original, target] of [
    [artifact, path],
    [scratch, scratchPath],
    [stage, stagePath],
  ] as const)
    if (!isDeepStrictEqual(original, await reconciliationInventory(store.root, target)))
      fail('physical_snapshot_changed');
  await requireSource();
  return freezeReconciliation({
    accounting,
    artifact,
    stage,
    scratch,
    scratchPath,
    downloadedTarballs: prefix,
    journaledBytes: entry.bytes,
    physicalBytes: artifact.bytes,
    unjournaledDownloadBytes: 0,
    originalInputVersion: expectedInputVersion,
    phase: descriptor.phase,
  });
}
