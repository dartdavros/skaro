import { expect, it } from 'vitest';
import {
  assertIncidentCondition,
  assertIncidentVerification,
} from './incident-verification-policy';

it('rejects an external failure routed to account verification before it can create a durable wait', () => {
  expect(() =>
    assertIncidentCondition({ cause: 'external', condition: 'provider-evidence' }),
  ).toThrow('only verifies');
  expect(() =>
    assertIncidentCondition({ cause: 'rate-limit', condition: 'provider-evidence' }),
  ).toThrow('only verifies');
  for (const cause of ['quota', 'authentication'] as const)
    expect(() =>
      assertIncidentVerification({ cause, condition: 'provider-evidence' }, false),
    ).not.toThrow();
});

it('requires a checkable plan before opening owner options and permits correction of legacy bindings', () => {
  const owner = { cause: 'external', condition: 'owner-evidence' } as const;
  expect(() => assertIncidentVerification(owner, false)).toThrow('before offering');
  expect(() => assertIncidentVerification(owner, true)).not.toThrow();
  expect(() =>
    assertIncidentVerification({ cause: 'external', condition: 'provider-evidence' }, true),
  ).not.toThrow();
});
