import { expect, it } from 'vitest';
import type { RuntimeAcceptanceState } from '@skaro/timeline';
import { requireSubmissionAssessment, type RecordedAssessment } from './submission.ts';

// Pure coverage/authority DTOs only: no primary journal, task/run or evidence result is created.
const host: RuntimeAcceptanceState = {
  revision: 'host-revision',
  criteriaRevision: 'criterion-revision',
  binding: {
    scope: { kind: 'task', projectId: 'contract', taskId: 'criterion-task', runId: 'run-marker' },
    checkout: 'contract-root',
    execution: 'allowed',
  },
  criteria: [{ id: 'criterion-1', met: false, evidenceIds: [] }],
  openDecisions: [],
  c4: 'current',
  result: 'not-submitted',
  continuation: 'allowed',
  reasons: [],
};
const value: RecordedAssessment = {
  kind: 'verification-assessment',
  schema: 1,
  readyToSubmit: true,
  hostRevision: host.revision,
  criteriaRevision: host.criteriaRevision,
  reasons: [],
  verdicts: [{ id: 'criterion-1', met: true, evidence: [{ sequence: 1, hash: 'a'.repeat(64) }] }],
};

it('requires a fresh successful assessment over every authoritative criterion', () => {
  expect(() => requireSubmissionAssessment(value, host)).not.toThrow();
  for (const changed of [
    undefined,
    { ...value, readyToSubmit: false },
    { ...value, hostRevision: 'old' },
    { ...value, criteriaRevision: 'old' },
    { ...value, reasons: ['unreviewed environment'] },
    { ...value, verdicts: [] },
    { ...value, verdicts: [...value.verdicts, ...value.verdicts] },
    { ...value, verdicts: [{ ...value.verdicts[0]!, id: 'foreign' }] },
    { ...value, verdicts: [{ ...value.verdicts[0]!, met: false }] },
    { ...value, verdicts: [{ ...value.verdicts[0]!, evidence: [] }] },
  ])
    expect(() => requireSubmissionAssessment(changed, host)).toThrow();
});

it('refuses stopped execution, stale C4, open decisions and host blockers even with a positive DTO', () => {
  for (const changed of [
    { ...host, c4: 'stale' },
    { ...host, continuation: 'stopped' },
    { ...host, openDecisions: ['owner-decision'] },
    { ...host, reasons: ['dependency missing'] },
    { ...host, binding: { ...host.binding!, execution: 'blocked' } },
  ])
    expect(() => requireSubmissionAssessment(value, changed as RuntimeAcceptanceState)).toThrow();
});

it('preserves partial reporting while requiring evidence for each positively claimed criterion', () => {
  const partialHost = {
    ...host,
    criteria: [...host.criteria, { id: 'criterion-2', met: false, evidenceIds: [] }],
  };
  const partial = {
    ...value,
    readyToSubmit: false,
    reasons: ['Criterion lacks a supported positive verdict: criterion-2'],
    unsupportedCriteria: ['criterion-2'],
    blockingReasons: [],
  };
  expect(requireSubmissionAssessment(partial, partialHost, ['criterion-1'])).toEqual(
    value.verdicts,
  );
  expect(() => requireSubmissionAssessment(partial, partialHost)).toThrow();
  expect(() => requireSubmissionAssessment(partial, partialHost, ['criterion-2'])).toThrow();
  expect(() => requireSubmissionAssessment(partial, partialHost, ['foreign'])).toThrow();
  expect(() => requireSubmissionAssessment(partial, partialHost, [])).toThrow();
  expect(() =>
    requireSubmissionAssessment(
      { ...partial, blockingReasons: ['Bound task evidence has no verification plan'] },
      partialHost,
      ['criterion-1'],
    ),
  ).toThrow();
});
