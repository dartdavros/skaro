import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { parseProjectWorkflow } from './preflight.ts';

it('requires exact artifact versions and separates prerequisites from future results', async () => {
  const path = 'package.json';
  const sha256 = createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
  const input = { kind: 'artifact', id: path, phase: 'result', producedBy: 'T-010', path, sha256 };
  expect(parseProjectWorkflow({ 'T-010': [input] })?.['T-010']?.[0]).toEqual(input);
  expect(() => parseProjectWorkflow({ 'T-010': [{ ...input, sha256: 'latest' }] })).toThrow(
    'exact SHA256',
  );
  expect(() =>
    parseProjectWorkflow({ 'T-010': [{ ...input, path: '../package.json' }] }),
  ).toThrow();
  expect(() => parseProjectWorkflow({ 'T-010': [{ ...input, phase: 'auto' }] })).toThrow();
});

it('rejects ambiguous, remote and credential-bearing readiness declarations', () => {
  const service = {
    kind: 'service',
    id: 'web',
    phase: 'prerequisite',
    url: 'http://localhost:18941',
  };
  expect(parseProjectWorkflow({ 'T-010': [service] })?.['T-010']).toHaveLength(1);
  for (const url of ['https://example.org', 'http://user:pass@localhost', 'file:///etc/passwd'])
    expect(() => parseProjectWorkflow({ 'T-010': [{ ...service, url }] })).toThrow();
  expect(() => parseProjectWorkflow({ 'T-010': [service, service] })).toThrow('Duplicate');
});
