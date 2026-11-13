import { expect, it } from 'vitest';
import { integrationRetirementEligible } from './integration-retirement-policy';

it('retries only applied or stale candidates without a worker/executor, independently of model availability', () => {
  for (const state of ['applied', 'stale'] as const) {
    expect(integrationRetirementEligible({ state })).toBe(true);
    expect(integrationRetirementEligible({ state, worker: 'running-worker' })).toBe(false);
    expect(integrationRetirementEligible({ state, executor: 'running-executor' })).toBe(false);
  }
  for (const state of [
    'preparing',
    'resolving',
    'verifying',
    'ready',
    'paused',
    'waiting',
    'failed',
  ] as const)
    expect(integrationRetirementEligible({ state })).toBe(false);
});
