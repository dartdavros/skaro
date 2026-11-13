import { expect, it } from 'vitest';
import { CACHE_BYTE_LIMIT } from './managed-cache-files';
import { pnpmRuntimeAccountedBytes } from './managed-pnpm-runtime-budget';

it('precharges the expanded runtime as well as its archive, refusing a compressed-only custom budget', () => {
  const archive = 5 * 1024 ** 2,
    expanded = 20 * 1024 ** 2;
  expect(() => pnpmRuntimeAccountedBytes(archive, expanded, 10 * 1024 ** 2)).toThrow(
    'budget_retained',
  );
  expect(pnpmRuntimeAccountedBytes(archive, expanded, archive + expanded)).toBe(archive + expanded);
  expect(pnpmRuntimeAccountedBytes(archive, expanded, CACHE_BYTE_LIMIT)).toBe(archive + expanded);
});

it('rejects unsafe or unbounded accounting rather than silently reducing an expansion reservation', () => {
  for (const values of [
    [-1, 1, 10],
    [1, -1, 10],
    [1, 1, -1],
    [1.5, 1, 10],
    [1, Infinity, 10],
    [Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER],
    [CACHE_BYTE_LIMIT, 1, CACHE_BYTE_LIMIT + 1],
  ])
    expect(() => pnpmRuntimeAccountedBytes(values[0]!, values[1]!, values[2]!)).toThrow();
});
