import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { artifactMetadata } from './managed-cache-metadata';
import { encodeNativeIdentity, pnpmTargetMatches } from './managed-native-identity';

const observed = { dev: 37n, ino: 13229323907920232n, birthtimeNs: 1794519347717123456n };
const legacy = {
  path: resolve('node_modules'),
  dev: 37,
  ino: 13229323907920232,
  birthtimeMs: 1794519347717.1235,
};
const entry = (installTarget: unknown) => ({
  manager: 'pnpm',
  expansionPolicy: 'pnpm-isolated-unique-nodes-v2',
  key: 'a'.repeat(64),
  projectId: 'pure-target-metadata',
  resourceId: `resource-${'b'.repeat(64)}`,
  generation: 1,
  state: 'retained',
  bytes: 0,
  expandedBytes: 0,
  expandedFiles: 0,
  usedAt: 1,
  immutable: false,
  installTarget,
});

it('reads and preserves unsafe legacy retained metadata verbatim without granting target authority', () => {
  const old = entry(legacy);
  const bytes = JSON.stringify([old]);
  const loaded = artifactMetadata(JSON.parse(bytes));
  expect(JSON.stringify(loaded)).toBe(bytes);
  expect(loaded[0]!.installTarget).toEqual(legacy);
  expect(loaded[0]!.installTarget).not.toHaveProperty('nativeIdentity');
  expect(pnpmTargetMatches(loaded[0]!.installTarget!, legacy.path, observed)).toBe(false);
});

it('strictly decodes explicitly tagged exact targets without reinterpreting legacy number fields', () => {
  const exact = { ...legacy, nativeIdentity: encodeNativeIdentity(observed) };
  const input = entry(exact);
  const bytes = JSON.stringify([input]);
  const loaded = artifactMetadata(JSON.parse(bytes));
  expect(JSON.stringify(loaded)).toBe(bytes);
  expect(pnpmTargetMatches(loaded[0]!.installTarget!, exact.path, observed)).toBe(true);
  expect(
    pnpmTargetMatches(loaded[0]!.installTarget!, exact.path, {
      ...observed,
      ino: observed.ino + 1n,
    }),
  ).toBe(false);
  // Even if legacy numeric values look usable, a malformed exact tag cannot fall back to them.
  for (const nativeIdentity of [
    undefined,
    null,
    {},
    { dev: '37', ino: '42', birthtimeNs: '1234000000' },
    { ...exact.nativeIdentity, version: 'native-bigint-v2' },
    { ...exact.nativeIdentity, ino: '013229323907920232' },
    { ...exact.nativeIdentity, dev: 37 },
    { ...exact.nativeIdentity, birthtimeNs: '-1' },
    { ...exact.nativeIdentity, birthtimeMs: '1794519347717' },
  ]) {
    const invalid = { path: exact.path, dev: 37, ino: 42, birthtimeMs: 1234, nativeIdentity };
    expect(() => artifactMetadata([entry(invalid)])).toThrow('metadata_invalid');
  }
});

it('does not accept new capabilities in an old shape, unknown fields, missing dimensions or npm metadata', () => {
  const exact = { ...legacy, nativeIdentity: encodeNativeIdentity(observed) };
  const { birthtimeMs: _birth, ...missingCompatibility } = exact;
  for (const invalid of [
    { ...exact, extra: 'authority' },
    { ...legacy, version: 'native-bigint-v1' },
    {
      ...legacy,
      dev: '37',
      ino: observed.ino.toString(),
      birthtimeNs: observed.birthtimeNs.toString(),
    },
    missingCompatibility,
    { ...exact, nativeIdentity: { version: 'native-bigint-v1', dev: '37', ino: '42' } },
  ])
    expect(() => artifactMetadata([entry(invalid)])).toThrow('metadata_invalid');
  expect(() => artifactMetadata([{ ...entry(exact), manager: 'npm' }])).toThrow('metadata_invalid');
});
