import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readCacheFile } from '../managed-cache-files';
import { readNpmArchive } from '../managed-npm-archive-reader';
import { NPM_INSTALL_BYTE_LIMIT, NPM_INSTALL_FILE_LIMIT } from '../managed-npm-archive';
import { PnpmInstallLayout } from '../managed-pnpm-install-layout';
import { pnpmLockTarballs, pnpmRecord } from '../managed-pnpm-lock';
import type { PnpmGraphFact } from '../managed-pnpm-graph-facts';

/** Read-only trusted originals; shared decoder facts are never sourced from an installed tree/sidecar. */
export async function readReconciliationArchiveFacts(
  root: string,
  artifactPath: string,
  lock: unknown,
) {
  const layout = new PnpmInstallLayout(lock, NPM_INSTALL_FILE_LIMIT, NPM_INSTALL_BYTE_LIMIT),
    graphFacts = new Map<string, PnpmGraphFact>();
  for (const tarball of pnpmLockTarballs(lock)) {
    const path = join(artifactPath, 'tarballs', `${tarball.hex}.tgz`);
    const before = await readCacheFile(root, path, NPM_INSTALL_BYTE_LIMIT);
    if (createHash('sha512').update(before.data).digest('hex') !== tarball.hex)
      throw new Error('cache_reconciliation_unique_public_tarball_changed');
    const archive = await readNpmArchive(path);
    const after = await readCacheFile(root, path, NPM_INSTALL_BYTE_LIMIT);
    if (!before.data.equals(after.data))
      throw new Error('cache_reconciliation_unique_archive_changed_during_read');
    let matched = false;
    for (const [id, pkg] of Object.entries(pnpmRecord(pnpmRecord(lock).packages))) {
      if (pnpmRecord(pnpmRecord(pkg).resolution).integrity !== tarball.integrity) continue;
      layout.register(id, archive);
      graphFacts.set(id, { manifestDigest: archive.manifestDigest, bins: archive.binTargets });
      matched = true;
    }
    if (!matched) throw new Error('cache_reconciliation_archive_not_in_original_lock');
  }
  return { complete: layout.assertComplete(), graphFacts };
}
