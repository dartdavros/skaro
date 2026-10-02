import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { captureFiles, putFile, restoreFiles } from './merge-files.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skaro-merge-files-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it('restores other published files while preserving a concurrent edit', async () => {
  await writeFile(join(dir, 'a'), 'original a');
  await writeFile(join(dir, 'b'), 'original b');
  const original = await captureFiles(dir, ['a', 'b']);
  await writeFile(join(dir, 'a'), 'published a');
  await writeFile(join(dir, 'b'), 'published b');
  const planned = await captureFiles(dir, ['a', 'b']);
  await writeFile(join(dir, 'b'), 'concurrent user edit');
  await expect(restoreFiles(dir, original, planned)).rejects.toThrow(
    'Concurrent edits retained at b',
  );
  expect(await readFile(join(dir, 'a'), 'utf8')).toBe('original a');
  expect(await readFile(join(dir, 'b'), 'utf8')).toBe('concurrent user edit');
});

it('restores a tracked directory that publication replaced with a file', async () => {
  await mkdir(join(dir, 'folder'));
  await writeFile(join(dir, 'folder/child'), 'original');
  const original = await captureFiles(dir, ['folder', 'folder/child']);
  await rm(join(dir, 'folder/child'));
  await rmdir(join(dir, 'folder'));
  await writeFile(join(dir, 'folder'), 'published file');
  const planned = await captureFiles(dir, ['folder', 'folder/child']);
  await restoreFiles(dir, original, planned);
  expect(await readFile(join(dir, 'folder/child'), 'utf8')).toBe('original');
});

it('does not remove an unexpected child when restoring a file over a directory', async () => {
  await mkdir(join(dir, 'folder'));
  await writeFile(join(dir, 'folder/user'), 'new user data');
  await expect(
    putFile(join(dir, 'folder'), {
      kind: 'file',
      data: Buffer.from('old file').toString('base64'),
      mode: 0o644,
    }),
  ).rejects.toThrow();
  expect(await readFile(join(dir, 'folder/user'), 'utf8')).toBe('new user data');
});
