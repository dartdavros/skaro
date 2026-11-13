import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import type { ResourceRecord, RunRecord } from '@skaro/core';
import {
  assertC4ImpactResource,
  assertC4ImpactRun,
  readC4ImpactSources,
  type C4ImpactObservation,
} from './c4-impact-observation';
import {
  assertC4ImpactReceipt,
  c4ObservationFingerprint,
  createC4ImpactReceipt,
  nextC4ImpactReceiptPointer,
  requireC4ObservationFresh,
} from './c4-impact-receipt';
import { memoryVersion } from './project-memory-sources';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const owner = { projectId: 'project', taskId: 'T-001', runId: 'current-run' };

/** Pure protocol metadata only: no registered projects, database records, files or services seeded. */
function metadata(): C4ImpactObservation {
  return {
    version: 1,
    impact: {
      version: 1,
      ...owner,
      checkout: '/registered/checkout',
      baseHead: 'a'.repeat(40),
      changeHash: hash('actual change bytes'),
      scopeHash: hash('scope'),
      expectedRevision: 2,
      requirements: ['R-1'],
      elements: ['component'],
      relationships: [],
      sources: [{ path: 'code.ts', hash: hash('source bytes') }],
      checks: [{ id: 'host.source-snapshot', fingerprint: hash('snapshot'), outcome: 'passed' }],
      discrepancies: [],
    },
    head: 'b'.repeat(40),
    runHash: hash('current run identity'),
    intent: 1,
    resource: { id: 'resource', generation: 1, identityHash: hash('registered owner') },
    inputs: {
      ...owner,
      version: hash('preflight'),
      requirements: hash('accepted requirements'),
      dependencies: [
        { taskId: 'T-000', status: 'done', head: 'c'.repeat(40), criteria: hash('criteria') },
      ],
      environment: hash('environment'),
      checks: hash('configured checks'),
      workflow: hash('workflow'),
      authority: hash('authority'),
    },
    scope: {
      kind: 'implementation',
      files: ['code.ts'],
      requirements: ['R-1'],
      elements: ['component'],
      relationships: [],
    },
    architectureHash: hash('affected architecture'),
    files: [
      { path: 'code.ts', hash: hash('source bytes') },
      { path: 'deleted.ts', hash: null },
    ],
  };
}

it('cannot upgrade a current worker legacy review into semantic approval or model publication', () => {
  const observation = metadata();
  const receipt = createC4ImpactReceipt(observation, {
    state: 'current',
    reviewHash: hash('worker authored aligned/evidence fields'),
    check: {
      id: 'host.legacy-review-preflight',
      fingerprint: hash('host preflight'),
      outcome: 'passed',
    },
  });
  expect(receipt.semanticEvidence).toBe('unverified');
  expect(receipt.nextStep).toBe('independent_semantic_review');
  expect(receipt.mayApply).toBe(false);
  expect(receipt.mayComplete).toBe(false);
  expect(receipt.modelWrite).toBe('none');
  expect(receipt).not.toHaveProperty('operation');
  assertC4ImpactReceipt(receipt, owner);
  const repeat = createC4ImpactReceipt(observation, receipt.legacyReview);
  expect(repeat).toEqual(receipt);
  observation.impact.sources[0]!.hash = hash('subsequent worker change');
  expect(receipt.observation.impact.sources[0]!.hash).toBe(hash('source bytes'));
  expect(() => assertC4ImpactReceipt({ ...receipt, mayComplete: true } as never)).toThrow();
});

it('freshness binds current run, Git, sources, scope, accepted dependencies, checks and authority', () => {
  const observed = metadata();
  const changes: ((value: C4ImpactObservation) => void)[] = [
    (v) => {
      v.impact.runId = 'replaced-run';
    },
    (v) => {
      v.head = 'd'.repeat(40);
    },
    (v) => {
      v.impact.baseHead = 'e'.repeat(40);
    },
    (v) => {
      v.impact.checkout = '/other/checkout';
    },
    (v) => {
      v.impact.changeHash = hash('new code');
    },
    (v) => {
      v.files[0]!.hash = hash('changed source');
    },
    (v) => {
      v.files[1]!.hash = hash('restored deleted source');
    },
    (v) => {
      v.scope.requirements.push('R-2');
    },
    (v) => {
      v.architectureHash = hash('changed affected model');
    },
    (v) => {
      v.inputs.dependencies[0]!.head = 'f'.repeat(40);
    },
    (v) => {
      v.inputs.requirements = hash('changed accepted requirements');
    },
    (v) => {
      v.inputs.checks = hash('different actual check contract');
    },
    (v) => {
      v.inputs.authority = hash('revoked authority');
    },
    (v) => {
      v.resource.generation++;
    },
    (v) => {
      v.intent++;
    },
  ];
  requireC4ObservationFresh(observed, structuredClone(observed));
  for (const change of changes) {
    const current = structuredClone(observed);
    change(current);
    expect(() => requireC4ObservationFresh(observed, current)).toThrow('stale');
  }
  const foreign = metadata();
  foreign.inputs.projectId = 'foreign';
  expect(() => c4ObservationFingerprint(foreign)).toThrow('ownership');
});

it('immutable receipts detect changed content, wrong owners and stale CAS generations', () => {
  const receipt = createC4ImpactReceipt(metadata(), { state: 'absent', reason: 'review_required' });
  expect(() => assertC4ImpactReceipt(receipt, { ...owner, runId: 'different' })).toThrow();
  const damaged = structuredClone(receipt);
  damaged.observation.impact.changeHash = hash('changed immutable content');
  expect(() => assertC4ImpactReceipt(damaged)).toThrow('damaged');
  const initial = nextC4ImpactReceiptPointer(undefined, receipt.id);
  expect(initial.generation).toBe(1);
  expect(nextC4ImpactReceiptPointer(initial, receipt.id)).toEqual(initial);
  const newerId = hash('new independently observed receipt');
  const newer = nextC4ImpactReceiptPointer(initial, newerId, initial);
  expect(newer.generation).toBe(2);
  expect(() => nextC4ImpactReceiptPointer(newer, hash('late writer'), initial)).toThrow(
    'generation changed',
  );
  expect(() => nextC4ImpactReceiptPointer(newer, receipt.id, initial)).toThrow(
    'generation changed',
  );
  expect(nextC4ImpactReceiptPointer(newer, newerId, initial)).toEqual(newer);
  expect(() =>
    nextC4ImpactReceiptPointer(
      { ...newer, generation: Number.MAX_SAFE_INTEGER },
      hash('overflow'),
      { ...newer, generation: Number.MAX_SAFE_INTEGER },
    ),
  ).toThrow('damaged');
});

it('rejects foreign, replaced, retired and unregistered checkout ownership from metadata', () => {
  const run: RunRecord = {
    id: owner.runId,
    projectId: owner.projectId,
    taskId: owner.taskId,
    agent: 'agent',
    adapterVersion: 'version',
    logPath: 'not-read',
    startedAt: 1,
  };
  assertC4ImpactRun(owner, run, run);
  expect(() => assertC4ImpactRun(owner, { ...run, projectId: 'foreign' }, run)).toThrow();
  expect(() => assertC4ImpactRun(owner, run, { ...run, id: 'successor' })).toThrow();
  expect(() => assertC4ImpactRun(owner, { ...run, retiredAt: 2 }, run)).toThrow();
  const resource: ResourceRecord = {
    id: 'resource',
    projectId: owner.projectId,
    kind: 'worktree',
    identity: { path: '/registered/checkout' },
    owner: { kind: 'task', id: owner.taskId },
    purpose: 'worktree',
    ownership: 'registered',
    preservation: 'disposable',
    generation: 1,
    consumers: [],
    state: 'available',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  assertC4ImpactResource(owner, '/registered/checkout', false, resource);
  for (const changed of [
    { ...resource, state: 'released' as const },
    { ...resource, ownership: 'legacy-unverified' as const },
    { ...resource, owner: { kind: 'task' as const, id: 'T-999' } },
    { ...resource, projectId: 'foreign' },
  ])
    expect(() => assertC4ImpactResource(owner, '/registered/checkout', false, changed)).toThrow();
  expect(() => assertC4ImpactResource(owner, '/other/checkout', false, resource)).toThrow();
  expect(() => assertC4ImpactResource(owner, '/registered/checkout', true, resource)).toThrow();
});

it('hashes actual Skaro source bytes without writing files and rejects traversal/directories', async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const path = 'apps/desktop/src/main/c4-impact-receipt.ts';
  const actual = createHash('sha256')
    .update(await readFile(new URL('./c4-impact-receipt.ts', import.meta.url)))
    .digest('hex');
  const paths = [path, path, 'docs/c4-observation-nonexistent-source.ts'];
  const files = await readC4ImpactSources(root, paths);
  expect(files).toEqual([
    { path, hash: actual },
    { path: paths[2], hash: null },
  ]);
  expect(memoryVersion(files)).toBe(
    memoryVersion(await readC4ImpactSources(root, [...paths].reverse())),
  );
  await expect(readC4ImpactSources(root, ['../package.json'])).rejects.toThrow('relative');
  await expect(readC4ImpactSources(root, ['C:\\outside\\file.ts'])).rejects.toThrow('relative');
  await expect(readC4ImpactSources(root, ['apps/desktop/src/main'])).rejects.toThrow(
    'concrete file',
  );
});
