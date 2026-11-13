import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readCacheFile } from '../managed-cache-files';
import { inspectPnpmRuntimeArchive } from '../managed-pnpm-runtime-inspection';
import { pnpmLockTarballs } from '../managed-pnpm-lock';
import type { reconciliationInventory } from './cache-verification-reconciliation-layout';

/** Full pinned SDK + exact original-lock payload prefix. No store, links or unknown files accepted. */
export async function readReconciliationArchives(
  root: string,
  path: string,
  artifact: Awaited<ReturnType<typeof reconciliationInventory>>,
  lock: unknown,
) {
  const fail = (reason: string): never => {
    throw new Error(`cache_reconciliation_${reason}`);
  };
  const archive = await inspectPnpmRuntimeArchive(root, join(path, 'pnpm.tgz'));
  const expectedDirectories = [
    '',
    'runtime',
    'tarballs',
    ...archive.directories.map((dir) => `runtime/${dir}`),
  ].sort();
  if (!isDeepStrictEqual(artifact.directories, expectedDirectories)) fail('artifact_phase_unknown');
  const runtimeFiles = artifact.files
    .filter((file) => file.path.startsWith('runtime/'))
    .map((file) => ({ ...file, path: file.path.slice('runtime/'.length) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (
    !isDeepStrictEqual(runtimeFiles, archive.files) ||
    runtimeFiles.reduce((sum, file) => sum + file.bytes, 0) !== archive.expandedBytes
  )
    fail('runtime_content_changed');
  const lockedTarballs = pnpmLockTarballs(lock);
  const allowed = new Set(lockedTarballs.map((tarball) => tarball.hex));
  const downloaded: string[] = [];
  for (const file of artifact.files) {
    if (file.path === 'pnpm.tgz' || file.path.startsWith('runtime/')) continue;
    const match = /^tarballs\/([a-f0-9]{128})\.tgz$/.exec(file.path);
    if (!match || !allowed.has(match[1]!)) fail('public_tarball_unknown');
    const bytes = (await readCacheFile(root, join(path, file.path), 256 * 1024 ** 2)).data;
    if (
      createHash('sha256').update(bytes).digest('hex') !== file.digest ||
      createHash('sha512').update(bytes).digest('hex') !== match![1]
    )
      fail('public_tarball_changed');
    downloaded.push(match![1]!);
  }
  const prefix = lockedTarballs.slice(0, downloaded.length).map((tarball) => tarball.hex);
  if (!isDeepStrictEqual([...prefix].sort(), downloaded)) fail('download_order_unknown');
  return { lockedTarballs, downloaded, prefix };
}
