import { expect, it } from 'vitest';
import { cacheEviction, immutableCacheKey, type CacheCandidate } from './resource-cache-policy';

it('separates immutable caches by project, lockfile, tool, platform and configuration', () => {
  const input = {
    projectId: 'project',
    kind: 'dependencies' as const,
    lockDigest: 'a'.repeat(64),
    toolVersion: '1',
    platform: 'windows-x64',
    configurationDigest: 'b'.repeat(64),
  };
  const key = immutableCacheKey(input);
  expect(immutableCacheKey({ ...input })).toBe(key);
  for (const changed of [
    { projectId: 'another' },
    { kind: 'buildkit' as const },
    { lockDigest: 'c'.repeat(64) },
    { toolVersion: '2' },
    { platform: 'linux-arm64' },
    { configurationDigest: 'd'.repeat(64) },
  ])
    expect(immutableCacheKey({ ...input, ...changed })).not.toBe(key);
  expect(() => immutableCacheKey({ ...input, lockDigest: '' })).toThrow('incomplete');
});

it('reclaims only verified unused immutable private objects and reports an unmet budget', () => {
  const eligible: CacheCandidate = {
    id: 'unused',
    bytes: 100,
    usedAt: 1,
    consumers: 0,
    ownership: 'registered',
    preservation: 'reproducible',
    immutable: true,
    secretsExcluded: true,
    privateScope: true,
  };
  const candidates = [
    eligible,
    { ...eligible, id: 'active', consumers: 1 },
    { ...eligible, id: 'unknown', ownership: 'unknown' as const },
    { ...eligible, id: 'unique', preservation: 'unique' as const },
    { ...eligible, id: 'secret', secretsExcluded: false },
    { ...eligible, id: 'shared-builder', privateScope: false },
    { ...eligible, id: 'mutable', immutable: false },
  ];
  const result = cacheEviction(candidates, { bytes: 0, entries: 0, idleMs: 0 }, 100);
  expect(result.remove).toEqual(['unused']);
  expect(result.retained).toHaveLength(6);
  expect(result.fits).toBe(false);
  expect(cacheEviction([eligible], { bytes: 100, entries: 1, idleMs: 100 }, 20).remove).toEqual([]);
  expect(cacheEviction([eligible], { bytes: 100, entries: 1, idleMs: 5 }, 20).remove).toEqual([
    'unused',
  ]);
  expect(
    cacheEviction([eligible], { bytes: 100, entries: 1, idleMs: 100 }, 20, 0, 1).remove,
  ).toEqual(['unused']);
});

it('fails closed on unknown, overflowed or duplicate cache accounting', () => {
  const entry: CacheCandidate = {
    id: 'object',
    bytes: 1,
    usedAt: 1,
    consumers: 0,
    ownership: 'registered',
    preservation: 'reproducible',
    immutable: true,
    secretsExcluded: true,
    privateScope: true,
  };
  const budget = { bytes: Number.MAX_SAFE_INTEGER, entries: 10, idleMs: 100 };
  expect(() => cacheEviction([entry, entry], budget, 10)).toThrow('accounting');
  expect(() => cacheEviction([{ ...entry, bytes: NaN }], budget, 10)).toThrow('accounting');
  expect(() =>
    cacheEviction([{ ...entry, bytes: Number.MAX_SAFE_INTEGER }], budget, 10, 1),
  ).toThrow('accounting');
  expect(() => cacheEviction([entry], budget, 10, 0, -1)).toThrow('accounting');
});
