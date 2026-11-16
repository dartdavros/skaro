import { readFile } from 'node:fs/promises';
import { c4Hash, git } from '@skaro/core';
import { expect, it } from 'vitest';
import { c4ChangeHash, c4DiffHash } from './c4-fingerprint';

it('retains exact legacy C4 fingerprints for escaped and multibyte streamed diff chunks', async () => {
  const observed = await readFile('README.md', 'utf8');
  const chunks = [observed, '\n\r\t"\\\0', 'Разрешение 🛠️', observed];
  const files = [['README.md', c4Hash(Buffer.from(observed).toString('base64'))]];
  const streamed = c4DiffHash();
  for (const chunk of chunks) streamed.write(chunk);
  expect(streamed.finish(files)).toBe(c4Hash(JSON.stringify({ diff: chunks.join(''), files })));
  const head = (await git(process.cwd(), ['rev-parse', 'HEAD'])).stdout.trim();
  expect(await c4ChangeHash(process.cwd(), head, head)).toBe(
    c4Hash(JSON.stringify({ diff: '', files: [] })),
  );
});
