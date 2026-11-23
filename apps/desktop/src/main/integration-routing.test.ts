import { expect, it } from 'vitest';
import { integrationHoldsTask, isTaskContinuationInput } from './integration-routing';

it('routes durable incident continuation and diagnosis to the original task', () => {
  expect(
    isTaskContinuationInput({ internal: true, commandId: 'continue-incident-id-run', text: '' }),
  ).toBe(true);
  expect(
    isTaskContinuationInput({ internal: true, commandId: 'diagnose-incident-id-run', text: '' }),
  ).toBe(true);
  expect(isTaskContinuationInput({ commandId: 'continue-incident-id-run', text: '' })).toBe(false);
});

it('releases a stopped local candidate after its writer exits', () => {
  const candidate: Parameters<typeof integrationHoldsTask>[0] = {
    purpose: 'local',
    state: 'paused',
    taskId: 'T-010',
    results: [],
  };
  expect(integrationHoldsTask({ ...candidate, executor: 'writer' }, 'T-010')).toBe(true);
  expect(integrationHoldsTask(candidate, 'T-010')).toBe(false);
  expect(integrationHoldsTask({ ...candidate, purpose: 'publication' }, 'T-010')).toBe(true);
});
