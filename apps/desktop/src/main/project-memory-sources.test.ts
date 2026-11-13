import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { memoryVersion, publicMemoryText, requireMemoryPath } from './project-memory-sources';

it('binds a public source version to its exact bytes and rejects a path outside scope', async () => {
  const root = await realpath(process.cwd());
  const source = await readFile(join(root, 'package.json'), 'utf8');
  expect(memoryVersion(source)).toBe(
    memoryVersion(await readFile(await requireMemoryPath(root, 'package.json'), 'utf8')),
  );
  expect(memoryVersion(source.trim())).not.toBe(memoryVersion(source));
  await expect(requireMemoryPath(join(root, 'packages'), '../package.json')).rejects.toThrow(
    'outside',
  );
});

it('removes labelled inline credentials and private-key blocks from public text', () => {
  const text =
    'password=never-share\nAuthorization: Bearer private-value\n-----BEGIN PRIVATE KEY-----\nprivate-content\n-----END PRIVATE KEY-----';
  const redacted = publicMemoryText(text);
  expect(redacted).not.toContain('never-share');
  expect(redacted).not.toContain('private-value');
  expect(redacted).not.toContain('private-content');
  const json = JSON.stringify({ password: 'quoted private value', api_key: 'private-api-value' });
  expect(JSON.parse(publicMemoryText(json))).toEqual({
    password: '[redacted]',
    api_key: '[redacted]',
  });
  expect(publicMemoryText(JSON.stringify({ output: json }))).not.toContain('private-api-value');
  expect(publicMemoryText(JSON.stringify({ output: json }))).not.toContain('quoted private value');
});
