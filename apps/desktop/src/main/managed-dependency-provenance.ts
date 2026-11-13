import { dependencyConfiguration } from './managed-dependency-context';
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { readCacheFile } from './managed-cache-files';
import { immutableCacheKey } from './resource-cache-policy';

export const NPM_CACHE_CONFIGURATION = Object.freeze({
  publisher: 'npm-cacache-content-v2:1',
  registry: 'https://registry.npmjs.org/',
  ignoreScripts: true,
  offlineConsumer: true,
  audit: false,
  fund: false,
  installLinks: false,
  binLinks: false,
  include: ['dev', 'optional', 'peer'],
});
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export class UnsupportedDependencyCache extends Error {}
export interface LockedTarball {
  url: string;
  integrity: string;
  hex: string;
  copies: number;
  installNodes: number;
}

/** Deliberately narrow: never reinterpret pnpm/yarn, private registries, local sources or custom npmrc. */
export function npmLockTarballs(lock: unknown): LockedTarball[] {
  const fail = (): never => {
    throw new UnsupportedDependencyCache('managed_dependencies_unsupported_lock_or_registry');
  };
  if (!lock || typeof lock !== 'object') return fail();
  const value = lock as { lockfileVersion?: number; packages?: Record<string, unknown> };
  if (
    ![2, 3].includes(value.lockfileVersion ?? 0) ||
    !value.packages ||
    !Object.hasOwn(value.packages, '')
  )
    return fail();
  const tarballs = new Map<string, LockedTarball>();
  if (Object.keys(value.packages).length > 10000) return fail();
  for (const [path, data] of Object.entries(value.packages)) {
    if (!data || typeof data !== 'object') return fail();
    const entry = data as Record<string, unknown>;
    if (entry.workspaces || entry.link || entry.inBundle || entry.bundled) return fail();
    if (path === '') continue;
    if (
      path.length > 1024 ||
      path.split('/').length > 32 ||
      !path.startsWith('node_modules/') ||
      path.split('/').some((part) => ['..', '.', ''].includes(part))
    )
      return fail();
    if (typeof entry.resolved !== 'string' || typeof entry.integrity !== 'string') return fail();
    let url: URL;
    try {
      url = new URL(entry.resolved);
    } catch {
      return fail();
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'registry.npmjs.org' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith('.tgz') ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity)
    )
      return fail();
    const hex = Buffer.from(entry.integrity.slice(7), 'base64').toString('hex');
    const previous = tarballs.get(hex);
    if (previous && previous.url !== url.href) return fail();
    tarballs.set(hex, {
      url: url.href,
      integrity: entry.integrity,
      hex,
      copies: (previous?.copies ?? 0) + 1,
      installNodes: (previous?.installNodes ?? 0) + path.split('/').length,
    });
  }
  return [...tarballs.values()];
}

export async function dependencyProvenance(
  projectId: string,
  cwd: string,
  toolVersion: string,
  sourceContext = '.',
) {
  for (const name of [
    'pnpm-lock.yaml',
    'yarn.lock',
    'npm-shrinkwrap.json',
    '.npmrc',
    '.yarnrc.yml',
  ]) {
    try {
      await lstat(join(cwd, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    throw new UnsupportedDependencyCache(
      'managed_dependencies_unsupported_manager_or_configuration',
    );
  }
  let lockBytes: Buffer, packageBytes: Buffer;
  try {
    for (const name of ['package-lock.json', 'package.json']) {
      const info = await lstat(join(cwd, name));
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 ** 2)
        throw new UnsupportedDependencyCache('managed_dependencies_unsupported_lock');
    }
    lockBytes = (await readCacheFile(cwd, join(cwd, 'package-lock.json'), 16 * 1024 ** 2)).data;
    packageBytes = (await readCacheFile(cwd, join(cwd, 'package.json'), 16 * 1024 ** 2)).data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new UnsupportedDependencyCache('managed_dependencies_no_npm_lock');
    throw error;
  }
  const pkg = JSON.parse(packageBytes.toString()) as {
    packageManager?: string;
    workspaces?: unknown;
  };
  if (pkg.workspaces || (pkg.packageManager && !/^npm@\d/.test(pkg.packageManager)))
    throw new UnsupportedDependencyCache('managed_dependencies_unsupported_manager_or_workspaces');
  const manifest = JSON.parse(packageBytes.toString()) as Record<string, unknown>;
  if (manifest.overrides || manifest.bundleDependencies || manifest.bundledDependencies)
    throw new UnsupportedDependencyCache(
      'managed_dependencies_unsupported_dependency_configuration',
    );
  for (const group of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    const values = manifest[group];
    if (values === undefined) continue;
    if (
      !values ||
      typeof values !== 'object' ||
      Array.isArray(values) ||
      Object.values(values).some(
        (value) => typeof value !== 'string' || !/^[0-9A-Za-z.*+^~<>=| -]{1,256}$/.test(value),
      )
    )
      throw new UnsupportedDependencyCache(
        'managed_dependencies_unsupported_dependency_specification',
      );
  }
  const lockDigest = digest(lockBytes);
  const configurationDigest = digest(
    JSON.stringify(
      dependencyConfiguration(NPM_CACHE_CONFIGURATION, digest(packageBytes), sourceContext),
    ),
  );
  const platform = `${process.platform}-${process.arch}-node${process.versions.node}-abi${process.versions.modules}`;
  return {
    key: immutableCacheKey({
      projectId,
      kind: 'dependencies',
      lockDigest,
      toolVersion,
      platform,
      configurationDigest,
    }),
    lockDigest,
    configurationDigest,
    platform,
    lockBytes,
    packageBytes,
    tarballs: npmLockTarballs(JSON.parse(lockBytes.toString())),
  };
}
