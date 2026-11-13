import { join } from 'node:path';
import type { ManagedArtifact, ManagedCacheStore } from './managed-cache-store';
import type { PnpmProvenance } from './managed-pnpm-provenance';
import { cacheTree, cloneCacheTree, readCacheFile, removeCacheTree } from './managed-cache-files';
import { pnpmCommandArguments, pnpmEnvironment, pnpmOwnedCommand } from './managed-pnpm-command';
import { createPnpmTarget, pnpmNodeModules, removePnpmNodeModules } from './managed-pnpm-layout';
import { writePnpmInput } from './managed-pnpm-operation';
import { resourceExecution } from './resource-execution';
import { readPnpmGraphFacts } from './managed-pnpm-graph-facts';

/** Real publisher self-check from original source bytes, never a generated project or converted lock. */
export async function verifyPnpmStoreRoundtrip(
  store: ManagedCacheStore,
  entry: ManagedArtifact,
  provenance: PnpmProvenance,
  node: string,
) {
  if (!entry.digest) throw new Error('managed_pnpm_store_digest_missing');
  const work = join(store.root, 'scratch', `${entry.key}-${entry.generation}-original-lock-proof`);
  await cloneCacheTree(store.root, store.path(entry.key), work, entry.digest);
  const facts = await readPnpmGraphFacts(store.root, work, provenance.lock);
  const home = join(work, 'home'),
    env = await pnpmEnvironment(store.root, home);
  await writePnpmInput(store.root, work, provenance.packageBytes, provenance.lockBytes);
  const target = await createPnpmTarget(work);
  entry.installTarget = target;
  store.save(entry);
  await pnpmOwnedCommand(
    store,
    entry,
    node,
    pnpmCommandArguments(
      join(work, 'runtime', 'bin', 'pnpm.cjs'),
      'install',
      work,
      home,
      join(work, 'store'),
      target.path,
    ),
    work,
    env,
  );
  await pnpmNodeModules(work, target.path, target, { lock: provenance.lock, facts });
  if (
    !(await readCacheFile(store.root, join(work, 'package.json'), 16 * 1024 ** 2)).data.equals(
      provenance.packageBytes,
    ) ||
    !(await readCacheFile(store.root, join(work, 'pnpm-lock.yaml'), 16 * 1024 ** 2)).data.equals(
      provenance.lockBytes,
    ) ||
    (await cacheTree(store.root, store.path(entry.key))).digest !== entry.digest
  )
    throw new Error('managed_pnpm_original_lock_roundtrip_changed');
  await resourceExecution.getStore()!.requireCurrent();
  await removePnpmNodeModules(work, target.path, target);
  await removeCacheTree(store.root, work);
  delete entry.installTarget;
  store.save(entry);
}
