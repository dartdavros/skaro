import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { npmLockTarballs, dependencyProvenance } from './managed-dependency-provenance';
import { isolatedNpmEnvironment } from './managed-cache-command';
import {
  npmExpansionFits,
  npmArchivePath,
  npmArchiveExpansion,
  npmTarHeader,
  NPM_INSTALL_BYTE_LIMIT,
  NPM_INSTALL_FILE_LIMIT,
} from './managed-npm-archive';
import { managedCacheCost, requireManagedCacheBuildSlot } from './managed-cache-admission';
import { managedCacheArguments } from './managed-cache-tools';

it('derives public npm CAS entries from actual integrity and counts every locked install location', () => {
  const integrity = `sha512-${Buffer.alloc(64, 2).toString('base64')}`;
  const dependency = { resolved: 'https://registry.npmjs.org/tiny/-/tiny-1.0.0.tgz', integrity };
  const lock = {
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/tiny': dependency,
      'node_modules/other/node_modules/tiny': dependency,
    },
  };
  expect(npmLockTarballs(lock)).toEqual([
    { url: dependency.resolved, integrity, hex: '02'.repeat(64), copies: 2, installNodes: 6 },
  ]);
  for (const changed of [
    { ...dependency, resolved: 'https://private.example/tiny.tgz' },
    { ...dependency, resolved: 'https://token@registry.npmjs.org/tiny.tgz' },
    { ...dependency, resolved: 'https://registry.npmjs.org/tiny.tgz?token=secret' },
    { ...dependency, integrity: 'sha1-unsupported' },
    { ...dependency, link: true },
  ])
    expect(() =>
      npmLockTarballs({ ...lock, packages: { '': {}, 'node_modules/tiny': changed } }),
    ).toThrow('unsupported');
  expect(() => npmLockTarballs({ lockfileVersion: 1 })).toThrow('unsupported');
});

it('does not misrepresent the actual pnpm repository as supported npm cache input', async () => {
  await expect(
    dependencyProvenance('current-repository', resolve('.'), 'preflight'),
  ).rejects.toThrow('unsupported_manager');
});

it('bounds expanded bytes, directories and shims with lock multiplicity before offline installation', () => {
  expect(npmExpansionFits(100, 5, 3, 20, 1)).toEqual({ expandedBytes: 320, expandedFiles: 16 });
  expect(() => npmExpansionFits(NPM_INSTALL_BYTE_LIMIT, 1, 2)).toThrow('unsupported_archive');
  expect(() => npmExpansionFits(1, NPM_INSTALL_FILE_LIMIT, 2)).toThrow('unsupported_archive');
  expect(() => npmExpansionFits(Number.MAX_SAFE_INTEGER, 1, 2)).toThrow('unsupported_archive');
});

it('reserves distinct cache, clone, extraction and Docker budgets without unknown-volume zeroes', () => {
  const budget = { bytes: 1024 ** 3, entries: 32, idleMs: 1 };
  const cost = managedCacheCost('dependencies', budget, 'data', 'task');
  expect(cost.diskBytes).toEqual({ data: 4 * 1024 ** 3, task: 2 * 1024 ** 3 });
  expect(managedCacheCost('dependencies', budget, 'same', 'same').diskBytes.same).toBe(
    6 * 1024 ** 3,
  );
  const builder = managedCacheCost('buildkit', budget, 'data', 'task');
  expect(builder.environment).toBe(1);
  expect(builder.build).toBe(1);
  expect(builder.pools?.dockerDiskBytes).toBe(3 * 1024 ** 3);
  expect(() => managedCacheCost('dependencies', budget, '', 'task')).toThrow('unknown');
  expect(() => requireManagedCacheBuildSlot(1, 1)).toThrow('requires_available_build_slot');
  expect(() => requireManagedCacheBuildSlot(3, 1)).not.toThrow();
});

it('never accepts model-supplied provenance, paths, commands, secrets or package manager flags', () => {
  expect(managedCacheArguments({ action: 'install' }, 'dependencies')).toBe('install');
  for (const args of [
    { action: 'install', cwd: 'elsewhere' },
    { action: 'install', immutable: true },
    { action: 'install', command: 'npm install' },
    { action: 'install', ignoreScripts: false },
  ])
    expect(() => managedCacheArguments(args, 'dependencies')).toThrow('arguments_invalid');
  expect(() => managedCacheArguments({ builder: 'default' }, 'buildkit')).toThrow(
    'arguments_invalid',
  );
  const env = isolatedNpmEnvironment('managed-home');
  expect(env.HOME).toBe('managed-home');
  expect(env.NODE_OPTIONS).toBeUndefined();
  expect(Object.keys(env).some((key) => /TOKEN|PASSWORD|NPM_CONFIG|AUTH/i.test(key))).toBe(false);
});

it('requires one stripped portable root and still rejects escape paths, links and override records', () => {
  expect(npmArchivePath('node/package.json', 48)).toEqual({ root: 'node', nodes: 2 });
  expect(npmArchivePath('node/', 53)).toEqual({ root: 'node', nodes: 1 });
  for (const [path, type] of [
    ['/node/a', 48],
    ['node/../a', 48],
    ['node//a', 48],
    ['node/a:stream', 48],
    ['node/NUL', 48],
    ['node/a/', 48],
    ['node/a', 50],
    ['node/a', 120],
  ] as const)
    expect(() => npmArchivePath(path, type)).toThrow('unsupported_archive');
});
it.skipIf(!process.env.SKARO_CACHE_ARCHIVE_PREFLIGHT)(
  'inspects the actual integrity-bound DefinitelyTyped archive without extracting or creating fixtures',
  async () => {
    const path = process.env.SKARO_CACHE_ARCHIVE_PREFLIGHT!;
    expect((await stat(path)).size).toBeLessThan(16 * 1024 ** 2);
    const bytes = await readFile(path);
    expect(createHash('sha512').update(bytes).digest('hex')).toBe(
      'b8ccecbfdb2d0dda1f219071e141a1e19f598179c60bdb1e443b1c8a505c4c701e38593aecc660fe4f5b5957cef9b938a99986fa5e768519cbc14887d8b9c94e',
    );
    const header = npmTarHeader(
      gunzipSync(bytes, { maxOutputLength: 64 * 1024 ** 2 }).subarray(0, 512),
    );
    expect(header?.root).toBe('node');
    expect(header?.path).toBe('node/');
    const expanded = await npmArchiveExpansion(path, 1);
    expect(expanded.expandedBytes).toBeGreaterThan(0);
    expect(expanded.expandedFiles).toBeLessThan(NPM_INSTALL_FILE_LIMIT);
  },
);
