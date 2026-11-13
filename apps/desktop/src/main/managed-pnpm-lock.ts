import { isDeepStrictEqual } from 'node:util';
import { isAbsolute, normalize } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { UnsupportedDependencyCache, type LockedTarball } from './managed-dependency-provenance';

export const PNPM_VERSION = '10.11.0';
export const PNPM_MIRROR_POLICY = 'registry-id-native-file-mirror-v1';
export const PNPM_CONFIGURATION = Object.freeze({
  manager: `pnpm@${PNPM_VERSION}`,
  mirror: PNPM_MIRROR_POLICY,
  registry: 'https://registry.npmjs.org/',
  ignoreScripts: true,
  ignorePnpmfile: true,
  sideEffectsCache: false,
  managePackageManagerVersions: false,
  packageImportMethod: 'copy',
  nodeLinker: 'isolated',
  expansionPolicy: 'pnpm-isolated-unique-nodes-v2',
  installedGraph: 'original-lock-archive-manifests-edges-bins-v1',
  runtimeBudget: 'verified-expanded-bytes-before-extraction-v1',
  commandProfile: 'supported-config-relative-modules-typed-limits-all-dependencies-ndjson-v5',
  targetPreparation: 'exact-native-root-and-real-virtual-store-v1',
  hoist: false,
  commandShims: 'private-target-only-not-executed',
  offline: true,
});
export function pnpmUnsupported(): never {
  throw new UnsupportedDependencyCache(
    'managed_dependencies_unsupported_pnpm_lock_or_configuration',
  );
}
export function pnpmRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return pnpmUnsupported();
  return value as Record<string, unknown>;
}
export function parsePnpmLock(bytes: Buffer | string) {
  const doc = parseDocument(bytes.toString(), { uniqueKeys: true, strict: true });
  if (doc.errors.length || doc.warnings.length) return pnpmUnsupported();
  return pnpmRecord(doc.toJS({ maxAliasCount: 0 }));
}
const namePattern = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/;
const idPattern =
  /^((?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;
function packageId(value: string) {
  const match = idPattern.exec(value);
  if (!match || value.length > 256) return pnpmUnsupported();
  return { name: match[1]!, version: match[2]! };
}
function baseId(value: string) {
  if (value.length > 2048 || /[\\\s:%]/.test(value)) return pnpmUnsupported();
  const base = value.split('(')[0]!;
  packageId(base);
  // Peer contexts remain opaque, but cannot introduce local/protocol resolutions.
  if (
    value.slice(base.length) &&
    !/^(?:\([@a-zA-Z0-9_./+@()-]+\))+$/.test(value.slice(base.length))
  )
    return pnpmUnsupported();
  return base;
}
function references(
  value: unknown,
  packages: Record<string, unknown>,
  snapshots: Record<string, unknown>,
) {
  const groups = pnpmRecord(value);
  for (const group of ['dependencies', 'optionalDependencies']) {
    if (groups[group] === undefined) continue;
    for (const [name, reference] of Object.entries(pnpmRecord(groups[group]))) {
      if (!namePattern.test(name) || typeof reference !== 'string') return pnpmUnsupported();
      const id = `${name}@${reference}`;
      if (!Object.hasOwn(packages, baseId(id)) || !Object.hasOwn(snapshots, id))
        return pnpmUnsupported();
    }
  }
}
/** Registry-only lock9/single importer. Snapshot peer contexts count as distinct install copies. */
export function pnpmLockTarballs(input: unknown): LockedTarball[] {
  const lock = pnpmRecord(input);
  if (
    String(lock.lockfileVersion) !== '9.0' ||
    Object.keys(lock).some(
      (key) => !['lockfileVersion', 'settings', 'importers', 'packages', 'snapshots'].includes(key),
    )
  )
    return pnpmUnsupported();
  const settings = pnpmRecord(lock.settings);
  if (
    Object.keys(settings).some(
      (key) => !['autoInstallPeers', 'excludeLinksFromLockfile'].includes(key),
    ) ||
    Object.values(settings).some((value) => typeof value !== 'boolean')
  )
    return pnpmUnsupported();
  const importers = pnpmRecord(lock.importers),
    packages = pnpmRecord(lock.packages),
    snapshots = pnpmRecord(lock.snapshots);
  if (
    Object.keys(importers).length !== 1 ||
    !Object.hasOwn(importers, '.') ||
    Object.keys(packages).length > 4096 ||
    Object.keys(snapshots).length > 4096
  )
    return pnpmUnsupported();
  const importer = pnpmRecord(importers['.']);
  if (
    Object.keys(importer).some(
      (key) => !['dependencies', 'devDependencies', 'optionalDependencies'].includes(key),
    )
  )
    return pnpmUnsupported();
  for (const group of Object.values(importer))
    for (const [name, raw] of Object.entries(pnpmRecord(group))) {
      const ref = pnpmRecord(raw);
      if (
        !namePattern.test(name) ||
        Object.keys(ref).some((key) => !['specifier', 'version'].includes(key)) ||
        typeof ref.specifier !== 'string' ||
        !/^[0-9A-Za-z.*+^~<>=| -]{1,256}$/.test(ref.specifier) ||
        typeof ref.version !== 'string'
      )
        return pnpmUnsupported();
      const id = `${name}@${ref.version}`;
      if (!Object.hasOwn(packages, baseId(id)) || !Object.hasOwn(snapshots, id))
        return pnpmUnsupported();
    }
  const counts = new Map<string, number>();
  for (const [id, raw] of Object.entries(snapshots)) {
    const base = baseId(id),
      snapshot = pnpmRecord(raw);
    if (
      !Object.hasOwn(packages, base) ||
      Object.keys(snapshot).some(
        (key) =>
          ![
            'dependencies',
            'optionalDependencies',
            'transitivePeerDependencies',
            'optional',
          ].includes(key),
      )
    )
      return pnpmUnsupported();
    references(snapshot, packages, snapshots);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const tarballs = new Map<string, LockedTarball>();
  for (const [id, raw] of Object.entries(packages)) {
    const { name, version } = packageId(id),
      pkg = pnpmRecord(raw),
      resolution = pnpmRecord(pkg.resolution);
    if (
      Object.keys(resolution).some((key) => key !== 'integrity') ||
      typeof resolution.integrity !== 'string' ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(resolution.integrity) ||
      pkg.bundledDependencies ||
      pkg.bundleDependencies ||
      !counts.has(id)
    )
      return pnpmUnsupported();
    const hex = Buffer.from(resolution.integrity.slice(7), 'base64').toString('hex');
    const url = `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`;
    const previous = tarballs.get(hex);
    if (previous && previous.url !== url) return pnpmUnsupported();
    const copies = counts.get(id)!;
    tarballs.set(hex, {
      url,
      integrity: resolution.integrity,
      hex,
      copies: (previous?.copies ?? 0) + copies,
      // Store index, virtual folders, dependency links and layout metadata overhead.
      installNodes: (previous?.installNodes ?? 0) + copies * 12 + 8,
    });
  }
  return [...tarballs.values()];
}
/** The ONLY semantic difference permitted is each packages[id].resolution.tarball. */
export function assertPnpmMirror(
  original: unknown,
  mirror: unknown,
  files: ReadonlyMap<string, string>,
) {
  const source = pnpmRecord(original),
    candidate = structuredClone(pnpmRecord(mirror));
  const packages = pnpmRecord(candidate.packages);
  if (Object.keys(packages).length !== files.size) return pnpmUnsupported();
  for (const [id, path] of files) {
    if (!isAbsolute(path) || normalize(path) !== path || /[\r\n\0]/.test(path))
      return pnpmUnsupported();
    const resolution = pnpmRecord(pnpmRecord(packages[id]).resolution);
    if (resolution.tarball !== `file:${path}`) return pnpmUnsupported();
    delete resolution.tarball;
  }
  if (!isDeepStrictEqual(source, candidate)) return pnpmUnsupported();
}
export function pnpmMirrorLock(original: unknown, files: ReadonlyMap<string, string>) {
  pnpmLockTarballs(original);
  const mirror = structuredClone(pnpmRecord(original));
  for (const [id, path] of files)
    pnpmRecord(pnpmRecord(pnpmRecord(mirror.packages)[id]).resolution).tarball = `file:${path}`;
  assertPnpmMirror(original, mirror, files);
  const text = stringify(mirror);
  assertPnpmMirror(original, parsePnpmLock(text), files);
  return text;
}
