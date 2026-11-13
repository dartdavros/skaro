import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PnpmInstallLayout } from './managed-pnpm-install-layout';
import { readNpmArchive } from './managed-npm-archive-reader';
import { npmLegacyArchiveExpansion } from './managed-npm-archive';
import { npmArchiveBins } from './managed-npm-archive-bin';
import { NPM_INSTALL_BYTE_LIMIT, NPM_INSTALL_FILE_LIMIT } from './managed-npm-tar';
import { pnpmLockTarballs, pnpmRecord } from './managed-pnpm-lock';
import { readManagedPnpmInput } from './managed-pnpm-provenance';

// In-memory protocol metadata only: no fixture files, generated archives or processes.
const integrity = `sha512-${Buffer.alloc(64, 2).toString('base64')}`;
const lock = () => ({
  lockfileVersion: '9.0',
  settings: {},
  importers: {
    '.': {
      dependencies: {
        'consumer-a': { specifier: '1.0.0', version: '1.0.0' },
        'consumer-b': { specifier: '1.0.0', version: '1.0.0' },
      },
    },
  },
  packages: {
    'consumer-a@1.0.0': { resolution: { integrity } },
    'consumer-b@1.0.0': {
      resolution: { integrity: `sha512-${Buffer.alloc(64, 3).toString('base64')}` },
    },
    'mqtt@5.0.0': { resolution: { integrity: `sha512-${Buffer.alloc(64, 4).toString('base64')}` } },
  },
  snapshots: {
    'consumer-a@1.0.0': { dependencies: { mqtt: '5.0.0' } },
    'consumer-b@1.0.0': { dependencies: { mqtt: '5.0.0' } },
    'mqtt@5.0.0': {},
  },
});
const payload = (bins: string[] = []) => ({
  nodes: [
    { path: '', directory: true },
    { path: 'cli.js', directory: false },
  ],
  bytes: 200,
  bins,
});
it('charges full topology upfront, bins per consumer and requires every package fact before ready', () => {
  const plan = new PnpmInstallLayout(lock(), 4096, NPM_INSTALL_BYTE_LIMIT);
  expect(plan.snapshot()).toMatchObject({ nodes: 18, complete: false, shimFiles: 0 });
  expect(() => plan.assertComplete()).toThrow('unsupported_archive');
  plan.register('consumer-a@1.0.0', payload());
  plan.register('consumer-b@1.0.0', payload());
  const result = plan.register('mqtt@5.0.0', payload(['mqtt', 'mqtt_pub', 'mqtt_sub']));
  expect(result).toMatchObject({ nodes: 43, payloadBytes: 600, shimFiles: 18, complete: true });
  expect(result.expandedBytes).toBe(600 + 18 * 65536);
  expect(plan.assertComplete()).toEqual(result);
  expect(plan.register('mqtt@5.0.0', payload(['mqtt', 'mqtt_pub', 'mqtt_sub']))).toEqual(result);
});
it('rejects over-budget registration and unsafe/colliding facts without committing a partial prefix', () => {
  const plan = new PnpmInstallLayout(lock(), 30, NPM_INSTALL_BYTE_LIMIT);
  const before = plan.snapshot();
  expect(() => plan.register('mqtt@5.0.0', payload(['mqtt', 'mqtt_pub', 'mqtt_sub']))).toThrow(
    'unsupported_archive',
  );
  expect(plan.snapshot()).toEqual(before);
  for (const value of [
    payload(['a', 'A']),
    {
      ...payload(),
      nodes: [
        { path: '', directory: true },
        { path: '../escape', directory: false },
      ],
    },
  ])
    expect(() => plan.register('mqtt@5.0.0', value)).toThrow('unsupported_archive');
  expect(plan.snapshot()).toEqual(before);
  const limited = new PnpmInstallLayout(lock(), 4096, 100);
  expect(() => limited.register('mqtt@5.0.0', payload())).toThrow('unsupported_archive');
  expect(limited.snapshot().missingPackageIds).toHaveLength(3);
});
it('binds exact immutable manifest facts and rejects overlapping Windows shim suffixes', () => {
  const plan = new PnpmInstallLayout(lock(), 4096, NPM_INSTALL_BYTE_LIMIT);
  const facts = payload();
  plan.register('consumer-a@1.0.0', facts);
  facts.nodes[1]!.path = 'changed.js';
  expect(() => plan.register('consumer-a@1.0.0', facts)).toThrow('unsupported_archive');
  expect(() => plan.register('mqtt@5.0.0', payload(['mqtt', 'mqtt.cmd']))).toThrow(
    'unsupported_archive',
  );
  expect(() => plan.register('unknown@1.0.0', payload())).toThrow('unsupported_archive');
});
it('validates manifest executable metadata without turning a worker hasBin flag into facts', () => {
  const manifest = (value: unknown) => Buffer.from(JSON.stringify(value));
  expect(npmArchiveBins(manifest({ name: '@scope/tool', bin: './bin/cli.js' }))).toEqual([
    { command: 'tool', target: 'bin/cli.js' },
  ]);
  for (const bin of [
    { NUL: 'cli.js' },
    { tool: '../cli.js' },
    { tool: '/cli.js' },
    { tool: 'a:stream' },
    { Tool: 'a.js', tool: 'b.js' },
    { 'tool.': 'a.js' },
  ])
    expect(() => npmArchiveBins(manifest({ name: 'tool', bin }))).toThrow('unsupported_archive');
  expect(() => npmArchiveBins(manifest({ directories: { bin: 'bin' } }))).toThrow(
    'unsupported_archive',
  );
});
it.skipIf(
  !process.env.SKARO_CACHE_ARCHIVE_DIRECTORY_PREFLIGHT || !process.env.SKARO_PNPM_SOURCE_CONTEXT,
)(
  'verifies every real retained prefix archive and unique graph facts read-only, without installation',
  async () => {
    const { lock: original } = await readManagedPnpmInput(process.env.SKARO_PNPM_SOURCE_CONTEXT!);
    const directory = process.env.SKARO_CACHE_ARCHIVE_DIRECTORY_PREFLIGHT!;
    const files = new Set(await readdir(directory));
    const tarballs = pnpmLockTarballs(original),
      packages = pnpmRecord(original.packages);
    const plan = new PnpmInstallLayout(original, NPM_INSTALL_FILE_LIMIT, NPM_INSTALL_BYTE_LIMIT);
    let verified = 0,
      unique = 0,
      bytes = 0,
      legacyBytes = 0,
      legacyFiles = 0,
      missing = false;
    for (const tarball of tarballs) {
      const name = `${tarball.hex}.tgz`;
      if (!files.has(name)) {
        missing = true;
        continue;
      }
      expect(missing).toBe(false);
      const path = join(directory, name),
        compressed = await readFile(path);
      expect(createHash('sha512').update(compressed).digest('hex')).toBe(tarball.hex);
      const facts = await readNpmArchive(path);
      const legacy = await npmLegacyArchiveExpansion(path, tarball.copies, tarball.installNodes);
      legacyBytes += legacy.expandedBytes;
      legacyFiles += legacy.expandedFiles;
      for (const [id, pkg] of Object.entries(packages))
        if (pnpmRecord(pnpmRecord(pkg).resolution).integrity === tarball.integrity)
          plan.register(id, { nodes: facts.nodes, bytes: facts.bytes, bins: facts.bins });
      verified++;
      if (verified === 36)
        expect({ legacyBytes, legacyFiles }).toEqual({ legacyBytes: 7922114, legacyFiles: 4076 });
      unique += facts.nodes.length;
      bytes += facts.bytes;
      files.delete(name);
    }
    expect(files.size).toBe(0);
    expect({ legacyBytes, legacyFiles }).toEqual({ legacyBytes: 7949264, legacyFiles: 4117 });
    expect({ verified, unique, bytes }).toEqual({ verified: 37, unique: 1187, bytes: 7949264 });
    expect(plan.snapshot()).toMatchObject({ nodes: 1411, shimFiles: 9, complete: false });
    expect(plan.snapshot().missingPackageIds).toHaveLength(15);
    console.log('actual bounded archive/graph facts, read-only', {
      verified,
      unique,
      bytes,
      projectedNodes: plan.snapshot().nodes,
    });
  },
  120_000,
);
