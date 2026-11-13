import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cacheDirectory, canonicalCachePath, readCacheFile } from './managed-cache-files';
import {
  inspectManagedContext,
  managedContextDigest,
  type ManagedBuildFile,
  reviewedBuildTemplate,
  secretBuildPath,
} from './managed-build-context';
import {
  managedBuildHash,
  requireManagedScratch,
  validateManagedDockerfile,
  unsupportedManagedBuild,
} from './managed-build-recipe';
export {
  UnsupportedManagedBuild,
  validateManagedDockerfile,
  requireManagedScratch,
  MANAGED_BUILD_BYTE_LIMIT,
  MANAGED_BUILD_NODE_LIMIT,
} from './managed-build-recipe';
export { reviewedBuildTemplate, secretBuildPath } from './managed-build-context';

export interface ManagedBuildSource {
  files: string[];
  bytes: number;
  nodes: number;
  entries: ManagedBuildFile[];
  sourceDigest: string;
  recipeDigest: string;
  base: string;
}
export async function inspectManagedBuildSource(cwd: string): Promise<ManagedBuildSource> {
  const source = await inspectManagedContext(cwd);
  const text = (await readCacheFile(cwd, join(cwd, 'Dockerfile'), 128 * 1024)).data.toString(
    'utf8',
  );
  const recipe = validateManagedDockerfile(text);
  if (recipe.base === 'scratch') requireManagedScratch(text);
  if (source.entries.find((entry) => entry.path === 'Dockerfile')?.digest !== recipe.recipeDigest)
    unsupportedManagedBuild('recipe_changed');
  return { ...source, base: recipe.base, recipeDigest: recipe.recipeDigest };
}

/** Export the exact inspected bytes. Every read and the final frozen recipe are verified before a solve. */
export async function exportManagedBuildSource(
  cwd: string,
  root: string,
  target: string,
  source: ManagedBuildSource,
  created?: () => void,
) {
  if (
    managedContextDigest(source.entries) !== source.sourceDigest ||
    JSON.stringify(source.files) !== JSON.stringify(source.entries.map((entry) => entry.path))
  )
    unsupportedManagedBuild('snapshot_metadata_changed');
  if ((await inspectManagedBuildSource(cwd)).sourceDigest !== source.sourceDigest)
    unsupportedManagedBuild('source_changed');
  await canonicalCachePath(root, target, true);
  await cacheDirectory(root, dirname(target));
  await mkdir(target, { mode: 0o700 });
  created?.();
  const frozen: ManagedBuildFile[] = [];
  for (const entry of source.entries) {
    const { path } = entry;
    const { data, mode } = await readCacheFile(cwd, join(cwd, path), 64 * 1024 ** 2);
    if (
      data.length !== entry.bytes ||
      mode !== entry.mode ||
      managedBuildHash(data) !== entry.digest ||
      (secretBuildPath(path) && !reviewedBuildTemplate(path, data))
    )
      unsupportedManagedBuild('source_changed');
    await cacheDirectory(root, dirname(join(target, path)));
    await canonicalCachePath(root, join(target, path), true);
    await writeFile(join(target, path), data, { flag: 'wx', mode });
    const actual = await readCacheFile(root, join(target, path), 64 * 1024 ** 2);
    // Windows may normalize filesystem mode bits; the immutable export hashes its actual mode.
    frozen.push({
      path,
      mode: actual.mode,
      bytes: actual.data.length,
      digest: managedBuildHash(actual.data),
    });
    if (actual.data.length !== entry.bytes || managedBuildHash(actual.data) !== entry.digest)
      unsupportedManagedBuild('export_changed');
  }
  const recipe = validateManagedDockerfile(
    (await readCacheFile(root, join(target, 'Dockerfile'), 128 * 1024)).data.toString('utf8'),
  );
  if (recipe.recipeDigest !== source.recipeDigest || recipe.base !== source.base)
    unsupportedManagedBuild('recipe_changed');
  if ((await inspectManagedBuildSource(cwd)).sourceDigest !== source.sourceDigest)
    unsupportedManagedBuild('source_changed');
  return managedContextDigest(frozen);
}
