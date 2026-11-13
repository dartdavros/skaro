import { join } from 'node:path';
import { readCacheFile } from '../managed-cache-files';
import { assertPnpmMirror, parsePnpmLock, pnpmRecord } from '../managed-pnpm-lock';

/** Manifest byte equality and transport-only mirror, independent of the publication failure phase. */
export async function requireReconciliationMirror(
  root: string,
  artifactPath: string,
  scratchPath: string,
  input: { packageBytes: Buffer; lock: Record<string, unknown> },
) {
  const copied = (await readCacheFile(root, join(scratchPath, 'package.json'), 16 * 1024 ** 2))
    .data;
  if (!copied.equals(input.packageBytes))
    throw new Error('cache_reconciliation_unique_manifest_changed');
  const files = new Map<string, string>();
  for (const [id, pkg] of Object.entries(pnpmRecord(input.lock.packages))) {
    const integrity = pnpmRecord(pnpmRecord(pkg).resolution).integrity as string;
    files.set(
      id,
      join(
        artifactPath,
        'tarballs',
        `${Buffer.from(integrity.slice(7), 'base64').toString('hex')}.tgz`,
      ),
    );
  }
  const mirrored = await readCacheFile(root, join(scratchPath, 'pnpm-lock.yaml'), 16 * 1024 ** 2);
  assertPnpmMirror(input.lock, parsePnpmLock(mirrored.data), files);
}
