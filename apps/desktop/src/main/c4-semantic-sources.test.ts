import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { c4Hash, git } from '@skaro/core';
import { semanticTestObservation } from './c4-semantic-test-input';
import { c4SemanticSources } from './c4-semantic-sources';

it('provides exact base content and Git-normalized working identity without replacing raw hashes', async () => {
  const observed = await semanticTestObservation();
  const path = 'AGENTS.md',
    content = await readFile(path, 'utf8');
  observed.files = [{ path, hash: c4Hash(content) }];
  const sources = await c4SemanticSources(observed);
  const base = (
    await git(observed.impact.checkout, ['show', `${observed.impact.baseHead}:${path}`])
  ).stdout;
  const baseBlob = (
    await git(observed.impact.checkout, ['rev-parse', `${observed.impact.baseHead}:${path}`])
  ).stdout.trim();
  const working = (
    await git(observed.impact.checkout, ['hash-object', '--path=AGENTS.md', '--stdin'], {
      input: content,
    })
  ).stdout.trim();
  expect(sources).toEqual([
    {
      path,
      hash: c4Hash(content),
      content,
      base: { blob: baseBlob, content: base },
      workingBlob: working,
    },
  ]);
  expect(working).not.toBe(c4Hash(content));
});

it('rejects changed raw checkout bytes before any independent review', async () => {
  const observed = await semanticTestObservation();
  observed.files = [{ path: 'AGENTS.md', hash: c4Hash('not the actual observed bytes') }];
  await expect(c4SemanticSources(observed)).rejects.toThrow(
    'C4 source changed before reviewer input',
  );
});
