import { expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { readCacheFile } from './managed-cache-files';
import {
  parsePnpmLock,
  pnpmLockTarballs,
  pnpmRecord,
  pnpmMirrorLock,
  assertPnpmMirror,
  PNPM_VERSION,
} from './managed-pnpm-lock';
import { pnpmDependencyProvenance } from './managed-pnpm-provenance';
import { dependencyConfiguration } from './managed-dependency-context';
import { managedDependencyManager } from './managed-dependency-manager';
import { pnpmCommandArguments } from './managed-pnpm-command';
import { pnpmPrivatePath } from './managed-pnpm-layout';
import { pnpmShimTargets } from './managed-pnpm-shims';
import { PNPM_RUNTIME_TARBALL } from './managed-pnpm-runtime';

async function repositoryMetadata() {
  const root = resolve('.');
  return parsePnpmLock(
    (await readCacheFile(root, join(root, 'pnpm-lock.yaml'), 16 * 1024 ** 2)).data,
  );
}
// In-memory projection of actual repository metadata, never a fixture/project/lockfile on disk.
async function singleRegistryMetadata() {
  const actual = await repositoryMetadata(),
    id = 'prettier@3.9.9';
  return {
    lockfileVersion: actual.lockfileVersion,
    settings: actual.settings,
    importers: {
      '.': {
        devDependencies: {
          prettier: pnpmRecord(pnpmRecord(pnpmRecord(actual.importers)['.']).devDependencies)
            .prettier,
        },
      },
    },
    packages: { [id]: pnpmRecord(actual.packages)[id] },
    snapshots: { [id]: pnpmRecord(actual.snapshots)[id] },
  };
}
it('rejects actual Skaro workspace metadata and does not silently execute its pnpm10.27 pin', async () => {
  expect(() => pnpmLockTarballs({})).toThrow('unsupported');
  const actual = await repositoryMetadata();
  expect(() => pnpmLockTarballs(actual)).toThrow('unsupported');
  await expect(managedDependencyManager(resolve('.'))).rejects.toThrow('unsupported');
});

it('derives integrity-only public tarballs from actual registry metadata and counts peer-context copies', async () => {
  const lock = await singleRegistryMetadata(),
    original = pnpmLockTarballs(lock);
  expect(original).toHaveLength(1);
  expect(original[0]!.url).toBe('https://registry.npmjs.org/prettier/-/prettier-3.9.9.tgz');
  const duplicated = structuredClone(lock);
  Object.assign(duplicated.snapshots, {
    'prettier@3.9.9(peer@1.0.0)': duplicated.snapshots['prettier@3.9.9'],
  });
  expect(pnpmLockTarballs(duplicated)[0]!.copies).toBe(2);
  const changed = structuredClone(lock);
  pnpmRecord(pnpmRecord(changed.packages['prettier@3.9.9']).resolution).tarball =
    'https://private.example/package.tgz';
  expect(() => pnpmLockTarballs(changed)).toThrow('unsupported');
});
it('permits ONLY native-absolute file tarball resolution overrides, keeping every original lock field', async () => {
  const lock = await singleRegistryMetadata(),
    before = structuredClone(lock);
  const files = new Map([['prettier@3.9.9', resolve('owned mirror with spaces', 'verified.tgz')]]);
  const text = pnpmMirrorLock(lock, files),
    mirror = parsePnpmLock(text);
  expect(lock).toEqual(before);
  expect(
    pnpmRecord(pnpmRecord(pnpmRecord(mirror.packages)['prettier@3.9.9']).resolution).tarball,
  ).toBe(`file:${files.values().next().value}`);
  expect(() => assertPnpmMirror(lock, mirror, files)).not.toThrow();
  mirror.settings = {};
  expect(() => assertPnpmMirror(lock, mirror, files)).toThrow('unsupported');
  expect(() => pnpmMirrorLock(lock, new Map([['prettier@3.9.9', 'file:///not-native']]))).toThrow(
    'unsupported',
  );
  expect(() => parsePnpmLock('lockfileVersion: 9.0\nlockfileVersion: 9.0\n')).toThrow();
});
it('pins offline frozen no-hooks copy operations to private store and exact packaged JS', () => {
  const args = pnpmCommandArguments('pinned.cjs', 'install', 'work', 'home', 'store', 'modules');
  for (const flag of [
    '--offline',
    '--frozen-lockfile',
    '--ignore-scripts',
    '--ignore-pnpmfile',
    '--package-import-method=copy',
    '--config.side-effects-cache=false',
    '--config.manage-package-manager-versions=false',
  ])
    expect(args).toContain(flag);
  expect(args).not.toContain('--bin-links=false');
  expect(PNPM_RUNTIME_TARBALL.url).toBe(
    `https://registry.npmjs.org/pnpm/-/pnpm-${PNPM_VERSION}.tgz`,
  );
  expect(PNPM_RUNTIME_TARBALL.hex).toHaveLength(128);
});
it('preserves legacy default npm identity and distinguishes canonical selected subtrees', () => {
  expect(dependencyConfiguration('policy', 'digest')).toEqual(['policy', 'digest']);
  expect(dependencyConfiguration('policy', 'digest', 'gateway')).toEqual([
    'policy',
    'digest',
    { sourceContext: 'gateway' },
  ]);
  for (const context of [
    '../other',
    'gateway/../other',
    '/outside',
    'gateway\\child',
    'gateway//child',
  ])
    expect(() => dependencyConfiguration('policy', 'digest', context)).toThrow('context_invalid');
});
it('validates generated shim references without executing them and rejects external normalized targets', async () => {
  const root = resolve('node_modules'),
    shim = join(root, '.bin', process.platform === 'win32' ? 'vitest.cmd' : 'vitest');
  const bytes = (await readCacheFile(resolve('.'), shim, 64 * 1024)).data;
  expect(pnpmShimTargets(root, shim, bytes.toString()).length).toBeGreaterThan(0);
  expect(() => pnpmPrivatePath(root, resolve('package.json'))).toThrow('external_target');
  expect(() => pnpmShimTargets(root, shim, 'node "$basedir/../../outside.js"')).toThrow(
    'external_target',
  );
});
it.skipIf(!process.env.SKARO_PNPM_SOURCE_CONTEXT)(
  'reads explicitly authorized actual source only; no install or cache mutations',
  async () => {
    const cwd = process.env.SKARO_PNPM_SOURCE_CONTEXT!;
    expect(await managedDependencyManager(cwd)).toBe('pnpm');
    const a = await pnpmDependencyProvenance('read-only-source', cwd, 'metadata-only', 'gateway');
    const b = await pnpmDependencyProvenance('read-only-source', cwd, 'metadata-only');
    expect(a.tarballs.length).toBeGreaterThan(1);
    expect(a.key).not.toBe(b.key);
    expect(a.lockDigest).toBe(b.lockDigest);
    expect(a.packageBytes.toString()).toContain('pnpm@10.11.0');
  },
);
