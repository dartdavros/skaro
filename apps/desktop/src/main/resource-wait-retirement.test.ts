import { expect, it } from 'vitest';
import { capacityWaitRetirable } from './resource-wait-retirement';

it('never retires a live, queued, missing or uncertain external operation as an obsolete capacity wait', () => {
  const protocol = {
    code: 'environment_waiting_resource',
    phase: 'waiting' as const,
    operationId: 'original-start',
  };
  for (const state of ['queued', 'dispatching', 'uncertain'] as const)
    expect(capacityWaitRetirable('open', protocol, { state })).toBe(false);
  expect(capacityWaitRetirable('open', protocol)).toBe(false);
  for (const state of ['failed', 'rejected', 'succeeded'] as const)
    expect(capacityWaitRetirable('open', protocol, { state })).toBe(true);
  for (const phase of ['executing', 'verifying'] as const)
    expect(capacityWaitRetirable('open', { ...protocol, phase }, { state: 'failed' })).toBe(false);
});

it('retires only the legacy capacity policy, preserving actual startup/provider failures and closed history', () => {
  const protocol = { code: 'environment_waiting_resource', phase: 'waiting' as const };
  expect(capacityWaitRetirable('open', protocol)).toBe(true);
  for (const code of [
    'environment_resource_conflict',
    'environment_start_failed',
    'quota_exhausted',
  ])
    expect(capacityWaitRetirable('open', { ...protocol, code })).toBe(false);
  for (const state of ['resolved', 'cancelled'] as const)
    expect(capacityWaitRetirable(state, protocol)).toBe(false);
  expect(capacityWaitRetirable('open', undefined)).toBe(false);
});
