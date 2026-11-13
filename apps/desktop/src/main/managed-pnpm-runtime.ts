import { open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cacheDirectory, canonicalCachePath } from './managed-cache-files';
import { PNPM_VERSION } from './managed-pnpm-lock';
import type { LockedTarball } from './managed-dependency-provenance';
import { PNPM_RUNTIME_INTEGRITY, visitPnpmRuntimeArchive } from './managed-pnpm-runtime-reader';

export {
  PNPM_RUNTIME_INTEGRITY,
  PNPM_RUNTIME_BYTE_LIMIT,
  PNPM_RUNTIME_NODE_LIMIT,
} from './managed-pnpm-runtime-reader';
// Included in each artifact's budget; deliberately independent of the repository's own pnpm pin.
export const PNPM_RUNTIME_TARBALL: LockedTarball = Object.freeze({
  url: `https://registry.npmjs.org/pnpm/-/pnpm-${PNPM_VERSION}.tgz`,
  integrity: PNPM_RUNTIME_INTEGRITY,
  hex: Buffer.from(PNPM_RUNTIME_INTEGRITY.slice(7), 'base64').toString('hex'),
  copies: 1,
  installNodes: 0,
});
/** Bounded streaming extraction. Every path is regular/private; no tar process or package scripts. */
export async function extractPnpmRuntime(root: string, archive: string, target: string) {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const { expandedBytes } = await visitPnpmRuntimeArchive(root, archive, async (entry) => {
      const path = join(target, entry.path);
      if (entry.directory) {
        await cacheDirectory(root, path);
        return;
      }
      await cacheDirectory(root, dirname(path));
      await canonicalCachePath(root, path, true);
      file = await open(path, 'wx', 0o600);
      return {
        // writeFile handles partial OS writes while retaining the opened file's current position.
        write: (bytes) => file!.writeFile(bytes),
        end: async () => {
          await file!.close();
          file = undefined;
        },
      };
    });
    return expandedBytes;
  } finally {
    await file?.close();
  }
}
