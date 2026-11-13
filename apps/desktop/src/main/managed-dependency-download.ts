import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cacheBudget } from './resource-cache-policy';
import { cacheDirectory, canonicalCachePath } from './managed-cache-files';
import type { ManagedCacheStore, ManagedArtifact } from './managed-cache-store';
import type { LockedTarball } from './managed-dependency-provenance';
import { npmArchiveExpansion, npmExpansionFits } from './managed-npm-archive';
import { readNpmArchive } from './managed-npm-archive-reader';
import { resourceExecution } from './resource-execution';

/** Public streamed SHA512 CAS publication; capacity and bounded archive expansion precede sealing. */
export async function downloadManagedTarball(
  store: ManagedCacheStore,
  entry: ManagedArtifact,
  tarball: LockedTarball,
  reservedBytes: number,
  sweep: (entries: number, bytes: number) => Promise<void>,
  options?: { path: string; runtime?: boolean; inventory?: 'pnpm-payload' },
) {
  if (options?.runtime && options.inventory)
    throw new Error('managed_dependencies_archive_profile_invalid');
  const scope = resourceExecution.getStore();
  const signal = scope
    ? AbortSignal.any([scope.signal, AbortSignal.timeout(120000)])
    : AbortSignal.timeout(120000);
  const response = await fetch(tarball.url, { redirect: 'error', signal, credentials: 'omit' });
  if (!response.ok || !response.body)
    throw new Error('managed_dependencies_public_download_failed');
  try {
    const length = Number(response.headers.get('content-length'));
    const limit = Math.min(
      cacheBudget(store.db, 'dependencies').bytes,
      reservedBytes,
      256 * 1024 ** 2,
    );
    const expected = Number.isSafeInteger(length) && length > 0 ? length : limit;
    if (expected > limit) throw new Error('managed_dependencies_download_budget_exceeded');
    await sweep(0, expected);
    const remaining =
      Math.min(cacheBudget(store.db, 'dependencies').bytes, reservedBytes) -
      store.artifacts().reduce((sum, x) => sum + x.bytes, 0);
    const path =
      options?.path ??
      join(
        store.path(entry.key),
        '_cacache',
        'content-v2',
        'sha512',
        tarball.hex.slice(0, 2),
        tarball.hex.slice(2, 4),
        tarball.hex.slice(4),
      );
    await cacheDirectory(store.root, dirname(path));
    await canonicalCachePath(store.root, path, true);
    const file = await open(path, 'wx', 0o600),
      hash = createHash('sha512');
    let bytes = 0;
    try {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > Math.min(remaining, limit))
          throw new Error('managed_dependencies_download_budget_exceeded');
        hash.update(chunk);
        await file.writeFile(chunk);
      }
      if (hash.digest('hex') !== tarball.hex)
        throw new Error('managed_dependencies_integrity_mismatch');
    } finally {
      await file.close();
    }
    const archive = options?.inventory === 'pnpm-payload' ? await readNpmArchive(path) : undefined;
    const expansion = options?.runtime
      ? { expandedBytes: 0, expandedFiles: 0 }
      : archive
        ? npmExpansionFits(archive.bytes, archive.nodes.length, 1)
        : await npmArchiveExpansion(path, tarball.copies, tarball.installNodes);
    return { bytes, ...expansion, archive };
  } finally {
    await response.body.cancel().catch(() => undefined);
  }
}
