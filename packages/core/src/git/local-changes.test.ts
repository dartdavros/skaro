import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { git } from './command.ts';
import { assertLocalChanges, preserveLocalChanges } from './local-changes.ts';
import { repo, service, write, commit } from './git-test-support.ts';

it('preserves deletions, literal filenames, ignored binary files and both sides of staging', async () => {
  await commit(repo, 'inputs', { '.gitignore': '*.bin\n', 'gone.txt': 'original\n' });
  await write(repo, 'README.md', 'staged\n');
  await git(repo, ['add', 'README.md']);
  await write(repo, 'README.md', '# calc\n');
  await rm(join(repo, 'gone.txt'));
  await write(repo, 'literal[1].txt', 'untracked\n');
  const binary = Buffer.from([0, 255, 11, 13, 128, 9]);
  await writeFile(join(repo, 'runtime.bin'), binary);
  const status = (await git(repo, ['status', '--porcelain'])).stdout;
  const index = await readFile(join(repo, '.git/index'));
  const snapshot = await preserveLocalChanges(repo, await service.head(), [
    'README.md',
    'gone.txt',
    'literal[1].txt',
    'runtime.bin',
  ]);
  expect((await git(repo, ['show', `${snapshot.staged}:README.md`])).stdout).toBe('staged\n');
  expect((await git(repo, ['show', `${snapshot.working}:README.md`])).stdout).toBe('# calc\n');
  expect(
    (await git(repo, ['cat-file', '-e', `${snapshot.working}:gone.txt`], { allowFail: true })).code,
  ).not.toBe(0);
  expect((await git(repo, ['show', `${snapshot.working}:literal[1].txt`])).stdout).toBe(
    'untracked\n',
  );
  const hash = (await git(repo, ['hash-object', '--stdin'], { input: binary })).stdout.trim();
  expect((await git(repo, ['rev-parse', `${snapshot.working}:runtime.bin`])).stdout.trim()).toBe(
    hash,
  );
  expect((await git(repo, ['status', '--porcelain'])).stdout).toBe(status);
  expect(await readFile(join(repo, '.git/index'))).toEqual(index);
  expect(await preserveLocalChanges(repo, snapshot.base, snapshot.paths)).toEqual(snapshot);
  await write(repo, 'README.md', 'new concurrent edit\n');
  await expect(assertLocalChanges(repo, snapshot)).rejects.toThrow('changed during resolution');
}, 30_000);

it('captures directory replacements including every tracked and untracked child', async () => {
  await commit(repo, 'inputs', { 'folder/old.txt': 'old\n' });
  await write(repo, 'folder/old.txt', 'local tracked\n');
  await write(repo, 'folder/new.txt', 'local untracked\n');
  const snapshot = await preserveLocalChanges(repo, await service.head(), ['folder']);
  expect(snapshot.paths).toEqual(['folder', 'folder/new.txt', 'folder/old.txt']);
  expect((await git(repo, ['show', `${snapshot.working}:folder/new.txt`])).stdout).toBe(
    'local untracked\n',
  );
  await assertLocalChanges(repo, snapshot);
  await write(repo, 'folder/another.txt', 'concurrent new file\n');
  await expect(assertLocalChanges(repo, snapshot)).rejects.toThrow('changed during resolution');
}, 30_000);
