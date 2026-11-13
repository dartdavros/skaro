import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import { expect, it } from 'vitest';
import { exportInfo } from './history-file-storage';
import { newHistoryEntry } from './history-file-metadata';
import { publicationAction } from './history-publication-state';

it('recovers every publication checkpoint without overwriting a partial temporary file or an unknown target', () => {
  expect(publicationAction('missing', 'missing')).toBe('write');
  expect(publicationAction('missing', 'exact')).toBe('publish');
  expect(publicationAction('missing', 'changed')).toBe('retain');
  for (const state of ['missing', 'exact', 'changed'] as const) {
    expect(publicationAction('exact', state)).toBe('ready');
    expect(publicationAction('changed', state)).toBe('retain');
  }
});

it('verifies actual repository file bytes and rejects a changed digest, size or directory without writing anything', async () => {
  const root = (await git(process.cwd(), ['rev-parse', '--show-toplevel'])).stdout.trim();
  const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const path = join(root, 'package.json');
  const bytes = await readFile(path);
  const entry = newHistoryEntry(head, 'package.json', bytes);
  expect((await exportInfo(path, entry)).state).toBe('exact');
  expect((await exportInfo(path, { ...entry, digest: '0'.repeat(64) })).state).toBe('changed');
  expect((await exportInfo(path, { ...entry, bytes: entry.bytes + 1 })).state).toBe('changed');
  expect((await exportInfo(root, entry)).state).toBe('changed');
  expect(await readFile(path)).toEqual(bytes);
});
