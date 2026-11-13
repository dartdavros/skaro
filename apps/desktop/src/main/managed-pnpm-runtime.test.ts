import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { expect, it } from 'vitest';
import { cacheTree, readCacheFile } from './managed-cache-files';
import { inspectPnpmRuntimeArchive } from './managed-pnpm-runtime-inspection';
import {
  PNPM_RUNTIME_BYTE_LIMIT,
  PNPM_RUNTIME_INTEGRITY,
  PNPM_RUNTIME_NODE_LIMIT,
  PNPM_RUNTIME_TARBALL,
} from './managed-pnpm-runtime';

it('retains the exact official pnpm10.11 pin and independent bounded runtime policy', () => {
  expect(PNPM_RUNTIME_TARBALL.url).toBe('https://registry.npmjs.org/pnpm/-/pnpm-10.11.0.tgz');
  expect(PNPM_RUNTIME_INTEGRITY).toBe(
    'sha512-ZUBYP0HMX2KOs9l3Ps7oAvT575kjzEW2mJD7R5kdSwkpZGlOw6T3OKQgyRijMwYsi5JdMS9C5PDCY+tgNVH5dw==',
  );
  expect(PNPM_RUNTIME_TARBALL.integrity).toBe(PNPM_RUNTIME_INTEGRITY);
  expect(PNPM_RUNTIME_TARBALL.hex).toBe(
    Buffer.from(PNPM_RUNTIME_INTEGRITY.slice(7), 'base64').toString('hex'),
  );
  expect(PNPM_RUNTIME_BYTE_LIMIT).toBe(32 * 1024 ** 2);
  expect(PNPM_RUNTIME_NODE_LIMIT).toBe(8192);
});

it('rejects real unpinned repository bytes before gzip decoding and enforces archive scope', async () => {
  const root = resolve('.'),
    archive = join(root, 'package.json');
  await expect(inspectPnpmRuntimeArchive(root, archive)).rejects.toThrow(
    'managed_pnpm_runtime_integrity_mismatch',
  );
  await expect(inspectPnpmRuntimeArchive(join(root, 'apps', 'desktop'), archive)).rejects.toThrow(
    'managed_cache_path_outside_scope',
  );
});

// Opt-in actual owned cache only: never creates archives, fixture trees, extracts, or runs pnpm.
it.skipIf(!process.env.SKARO_CACHE_RUNTIME_PREFLIGHT)(
  'matches all pinned archive digests and directory parents against the existing real runtime read-only',
  async () => {
    const archive = resolve(process.env.SKARO_CACHE_RUNTIME_PREFLIGHT!),
      root = dirname(archive),
      target = join(root, 'runtime');
    const before = (await readCacheFile(root, archive, PNPM_RUNTIME_BYTE_LIMIT)).data,
      inspected = await inspectPnpmRuntimeArchive(root, archive),
      actual = await cacheTree(root, target, PNPM_RUNTIME_BYTE_LIMIT);
    expect(`sha512-${createHash('sha512').update(before).digest('base64')}`).toBe(
      PNPM_RUNTIME_INTEGRITY,
    );
    expect(inspected.expandedBytes).toBe(actual.bytes);
    expect(inspected.expandedBytes).toBe(
      inspected.files.reduce((sum, file) => sum + file.bytes, 0),
    );
    expect(inspected.files).toEqual(
      actual.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    );
    expect(inspected.files.some((file) => file.path === 'bin/pnpm.cjs')).toBe(true);
    expect(inspected.files.some((file) => file.path === 'dist/pnpm.cjs')).toBe(true);
    const directories = [...actual.nodes]
      .filter(([path, node]) => path !== target && node.info.isDirectory())
      .map(([path]) => relative(target, path).split(sep).join('/'))
      .sort();
    expect(inspected.directories).toEqual(directories);
    expect(inspected.directories).not.toContain('');
    expect(inspected.files.length + inspected.directories.length).toBeLessThanOrEqual(
      PNPM_RUNTIME_NODE_LIMIT,
    );
    expect((await readCacheFile(root, archive, PNPM_RUNTIME_BYTE_LIMIT)).data).toEqual(before);
    console.info('actual pnpm runtime archive inspection', {
      archiveBytes: before.length,
      expandedBytes: inspected.expandedBytes,
      files: inspected.files.length,
      directories: inspected.directories.length,
    });
  },
  120000,
);
