import { readFile, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { c4Hash } from './documents.ts';
import { c4ImpactFingerprint } from './impact-validation.ts';
import { c4RunProtocol, type C4Impact } from './impact-contract.ts';
import { assessC4Impact } from './impact-assessment.ts';

it('binds evidence to its real source and rejects changed scope, invalid paths and unknown protocols', async () => {
  const root = await realpath(process.cwd());
  const source = await readFile(join(root, 'package.json'), 'utf8');
  const head = (
    await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root })
  ).stdout.trim();
  const report: C4Impact = {
    version: 1,
    projectId: root,
    taskId: 'C4-1',
    runId: head,
    checkout: root,
    baseHead: head,
    changeHash: c4Hash(source),
    scopeHash: c4Hash(root),
    expectedRevision: 0,
    requirements: ['C4-1'],
    elements: [],
    relationships: [],
    sources: [{ path: 'package.json', hash: c4Hash(source) }],
    checks: [],
    discrepancies: [],
  };
  const fingerprint = c4ImpactFingerprint(report);
  expect(c4ImpactFingerprint({ ...report, runId: head + ':next' })).not.toBe(fingerprint);
  expect(() => c4ImpactFingerprint({ ...report, version: 2 } as unknown as C4Impact)).toThrow();
  expect(() =>
    c4ImpactFingerprint({
      ...report,
      sources: [{ path: '../package.json', hash: c4Hash(source) }],
    }),
  ).toThrow();
  const facts = {
    observed: report,
    semanticEvidence: 'unknown' as const,
    renames: [],
    dependencies: [
      { taskId: 'C4-1', requirements: ['C4-1'] },
      { taskId: 'AC-1', requirements: ['AC-1'] },
    ],
  };
  expect(assessC4Impact(report, facts)).toMatchObject({
    category: 'insufficient-evidence',
    mayApply: false,
    waiting: [{ taskId: 'C4-1', requirements: ['C4-1'], reason: 'verification_required' }],
  });
  expect(assessC4Impact({ ...report, projectId: root + ':other' }, facts).reason).toBe(
    'stale_or_foreign_evidence',
  );
  expect(c4RunProtocol(root, head)).toBe('package-v1');
  expect(c4RunProtocol(root, head, { projectId: root, runId: head, protocol: 'impact-v1' })).toBe(
    'impact-v1',
  );
  expect(() =>
    c4RunProtocol(root, head, { projectId: root, runId: head + ':other', protocol: 'impact-v1' }),
  ).toThrow();
});
