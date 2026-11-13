import { dependencyConfiguration } from './managed-dependency-context';
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { readCacheFile } from './managed-cache-files';
import { immutableCacheKey } from './resource-cache-policy';
import {
  parsePnpmLock,
  PNPM_CONFIGURATION,
  PNPM_VERSION,
  pnpmLockTarballs,
  pnpmRecord,
  pnpmUnsupported,
} from './managed-pnpm-lock';

const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
/** Shared source admission: dropping a forbidden source config while staging must never bypass rejection. */
export async function readManagedPnpmInput(cwd: string) {
  for (const name of [
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'pnpm-workspace.yaml',
    '.npmrc',
    '.pnpmfile.cjs',
    'pnpmfile.cjs',
    '.yarnrc.yml',
  ]) {
    try {
      await lstat(join(cwd, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    return pnpmUnsupported();
  }
  const packageBytes = (await readCacheFile(cwd, join(cwd, 'package.json'), 16 * 1024 ** 2)).data;
  const lockBytes = (await readCacheFile(cwd, join(cwd, 'pnpm-lock.yaml'), 16 * 1024 ** 2)).data;
  const manifest = pnpmRecord(JSON.parse(packageBytes.toString()));
  if (
    manifest.packageManager !== `pnpm@${PNPM_VERSION}` ||
    manifest.workspaces ||
    manifest.pnpm ||
    manifest.overrides ||
    manifest.bundleDependencies ||
    manifest.bundledDependencies
  )
    return pnpmUnsupported();
  for (const group of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    if (manifest[group] === undefined) continue;
    if (
      Object.values(pnpmRecord(manifest[group])).some(
        (value) => typeof value !== 'string' || !/^[0-9A-Za-z.*+^~<>=| -]{1,256}$/.test(value),
      )
    )
      return pnpmUnsupported();
  }
  return { packageBytes, lockBytes, lock: parsePnpmLock(lockBytes) };
}
/** Source is read only. Configuration/hooks/workspaces are never copied into operational staging. */
export async function pnpmDependencyProvenance(
  projectId: string,
  cwd: string,
  toolVersion: string,
  sourceContext = '.',
) {
  const { packageBytes, lockBytes, lock } = await readManagedPnpmInput(cwd);
  const tarballs = pnpmLockTarballs(lock);
  const lockDigest = digest(lockBytes),
    configurationDigest = digest(
      JSON.stringify(
        dependencyConfiguration(PNPM_CONFIGURATION, digest(packageBytes), sourceContext),
      ),
    );
  const platform = `${process.platform}-${process.arch}-node${process.versions.node}-abi${process.versions.modules}`;
  return {
    key: immutableCacheKey({
      projectId,
      kind: 'dependencies',
      lockDigest,
      configurationDigest,
      toolVersion,
      platform,
    }),
    lockDigest,
    configurationDigest,
    platform,
    lock,
    lockBytes,
    packageBytes,
    tarballs,
  };
}
export type PnpmProvenance = Awaited<ReturnType<typeof pnpmDependencyProvenance>>;
