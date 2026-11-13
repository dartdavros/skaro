import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { ManagedArtifact, ManagedCacheStore } from '../managed-cache-store';
import { readManagedPnpmInput } from '../managed-pnpm-provenance';
import { requireReconciliationMirror } from './cache-verification-reconciliation-mirror';
import {
  freezeReconciliation,
  pnpmInputVersion,
  reconciliationInventory,
} from './cache-verification-reconciliation-layout';
import { readReconciliationArchives } from './cache-verification-reconciliation-archives';
import { readUniqueReconciliationAccounting } from './cache-verification-reconciliation-unique-accounting';
import { assertUniqueReconciliationInputs } from './cache-verification-reconciliation-unique-inputs';
import {
  RECONCILIATION_UNIQUE_PHASE,
  uniqueReconciliationEntry,
  validReconciliationPublicationShape,
} from './cache-verification-reconciliation-unique';

/** Input freshness is independent of directory/head freshness and is checked around physical reads. */
export async function requireReconciliationSourceInput(path: string, version: string) {
  if (pnpmInputVersion(await readManagedPnpmInput(path)) !== version)
    throw new Error('cache_reconciliation_current_source_input_changed');
}

/** Complete downloads + exact pre-fetch-shaped trees, NOT a claim that fetch was never dispatched. */
export async function readUniqueReconciliationLayout(
  store: ManagedCacheStore,
  entry: ManagedArtifact,
  stagePath: string,
  expectedInputVersion: string,
  sourceInputPath: string,
  failure: 'prefetch-command',
) {
  const fail = (reason: string): never => {
    throw new Error(`cache_reconciliation_unique_${reason}`);
  };
  if (
    failure !== 'prefetch-command' ||
    !uniqueReconciliationEntry(entry) ||
    !validReconciliationPublicationShape(entry, 2, store.root)
  )
    fail('publication_required');
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
  const { lockedTarballs, downloaded, prefix } = await readReconciliationArchives(
    store.root,
    path,
    artifact,
    input.lock,
  );
  if (
    downloaded.length !== lockedTarballs.length ||
    artifact.bytes !== entry.bytes ||
    entry.bytes <= 0 ||
    !artifact.files.some((file) => file.path === 'pnpm.tgz' && file.bytes > 0)
  )
    fail('all_downloads_journaled_required');
  await requireReconciliationMirror(store.root, path, scratchPath, input);
  const accounting = await readUniqueReconciliationAccounting(store.root, path, entry, input.lock);
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
    phase: RECONCILIATION_UNIQUE_PHASE,
  });
}
