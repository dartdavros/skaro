import { createHash } from 'node:crypto';
import type { CacheFile } from './managed-cache-files';
import { visitPnpmRuntimeArchive } from './managed-pnpm-runtime-reader';

/** Read-only expected runtime inventory from the pinned archive; never extracts or executes pnpm. */
export async function inspectPnpmRuntimeArchive(
  root: string,
  archive: string,
): Promise<{ files: CacheFile[]; directories: string[]; expandedBytes: number }> {
  const files: CacheFile[] = [];
  const result = await visitPnpmRuntimeArchive(root, archive, (entry) => {
    if (entry.directory) return;
    const hash = createHash('sha256');
    return {
      write: (bytes) => {
        hash.update(bytes);
      },
      end: () => {
        files.push({ path: entry.path, bytes: entry.bytes, digest: hash.digest('hex') });
      },
    };
  });
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, ...result };
}
