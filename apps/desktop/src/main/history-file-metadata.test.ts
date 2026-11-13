import { expect, it } from 'vitest';
import { git, GitSnapshot } from '@skaro/core';
import { historyEntries, newHistoryEntry } from './history-file-metadata';

it('journals exact real Git content with unique no-overwrite publication paths and validates replay', async () => {
  const repo = (await git(process.cwd(), ['rev-parse', '--show-toplevel'])).stdout.trim();
  const head = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const bytes = await new GitSnapshot(repo, head).read('package.json');
  const first = newHistoryEntry(head, 'package.json', bytes);
  const successor = newHistoryEntry(head, 'package.json', bytes);
  expect(successor.identity).toBe(first.identity);
  expect(successor.digest).toBe(first.digest);
  expect(successor.name).not.toBe(first.name);
  expect(successor.pending).not.toBe(first.pending);
  expect(historyEntries(JSON.parse(JSON.stringify([first, successor])))).toEqual([
    first,
    successor,
  ]);
  expect(first.phase).toBe('writing');
  for (const change of [
    { name: '../outside' },
    { generation: 0 },
    { bytes: -1 },
    { usedAt: Infinity },
    { identity: 'another' },
    { pending: successor.pending },
    { phase: 'ready', commit: undefined },
  ])
    expect(() => historyEntries([{ ...first, ...change }])).toThrow('inventory is invalid');
  expect(() => historyEntries([first, first])).toThrow('inventory is invalid');
  expect(() => historyEntries({})).toThrow('inventory is invalid');
});

it('retains legacy exports as unknown rather than granting verified publication or evictability', () => {
  const legacy = {
    name: `${'a'.repeat(64)}-package.json`,
    digest: 'b'.repeat(64),
    bytes: 120,
    usedAt: 1,
  };
  expect(historyEntries([legacy])[0]).toMatchObject({ phase: 'legacy', generation: 1 });
  expect(historyEntries([legacy])[0]?.commit).toBeUndefined();
  expect(() => historyEntries([{ ...legacy, claimedOwned: true }])).toThrow('inventory is invalid');
});
