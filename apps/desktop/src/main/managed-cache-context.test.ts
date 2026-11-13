import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { managedContextArgument, selectManagedCacheContext } from './managed-cache-context';
import { managedCacheArguments } from './managed-cache-tools';
import { managedCacheCost } from './managed-cache-admission';

it('narrows a task root without accepting external paths or approval assertions', () => {
  expect(managedContextArgument()).toBe('.');
  expect(managedContextArgument('packages/valid name')).toBe('packages/valid name');
  expect(managedCacheArguments({ context: 'backend' }, 'buildkit')).toBe('verify');
  expect(managedCacheArguments({ action: 'install', context: 'gateway' }, 'dependencies')).toBe(
    'install',
  );
  for (const context of [
    '',
    '/',
    '../other',
    'a/../b',
    'a/./b',
    'a//b',
    'a\\b',
    'C:/other',
    'a/',
    'NUL',
    'foo.',
    '\u0000',
    '\u007f',
  ])
    expect(() => managedContextArgument(context)).toThrow('context_invalid');
  expect(() => managedCacheArguments({ context: 'backend', approval: true }, 'buildkit')).toThrow(
    'arguments_invalid',
  );
});

it('validates actual repository directories without creating a project or changing files', async () => {
  const root = resolve('.'),
    selected = await selectManagedCacheContext(root, 'apps/desktop/src/main');
  expect(selected.root).toBe(root);
  expect(selected.cwd).toBe(resolve(root, 'apps/desktop/src/main'));
  await selected.requireCurrent();
  await expect(selectManagedCacheContext(root, 'package.json')).rejects.toThrow(
    'directory_required',
  );
});

it('reserves transient trusted-build costs separately from idle cache without unsafe integers', () => {
  const budget = { bytes: 2 * 1024 ** 3, entries: 1, idleMs: 1 };
  const scratch = managedCacheCost('buildkit', budget, 'same', 'same', 128, 'scratch');
  const trusted = managedCacheCost('buildkit', budget, 'same', 'same', 128, 'trusted-run');
  expect(scratch.pools?.dockerRamBytes).toBe(512 * 1024 ** 2);
  expect(trusted.pools?.dockerRamBytes).toBe(1024 ** 3);
  expect(trusted.pools?.dockerCpuMillis).toBe(2000);
  expect(trusted.pools?.dockerDiskBytes).toBe(budget.bytes + 6 * 1024 ** 3);
  expect(trusted.diskBytes.same).toBe(128 * 1024 ** 2);
  expect(() => managedCacheCost('buildkit', budget, 'a', 'b', Number.MAX_SAFE_INTEGER)).toThrow(
    'unknown',
  );
});
