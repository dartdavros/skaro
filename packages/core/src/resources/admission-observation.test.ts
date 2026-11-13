import { expect, it } from 'vitest';
import type { ResourceBudget, ResourceLease } from './admission-model.ts';
import { resourceAdmissionReason } from './admission-policy.ts';

it('does not subtract observed container use twice and still reserves pending growth', () => {
  const now = Date.now();
  const request: ResourceLease = {
    id: 'next',
    projectId: 'project',
    ownerId: 'environment:next',
    intentId: 'next',
    checkpoint: 'start',
    cost: {
      ramBytes: 300,
      cpuMillis: 100,
      model: 0,
      environment: 1,
      build: 0,
      review: 0,
      diskBytes: {},
      pools: { dockerRamBytes: 300 },
    },
    locks: [],
    state: 'waiting_resource',
    reason: 'queued',
    sequence: 2,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  const holder: ResourceLease = {
    ...request,
    id: 'live',
    sequence: 1,
    state: 'granted',
    cost: { ...request.cost, ramBytes: 400, pools: { dockerRamBytes: 400 } },
  };
  const budget: ResourceBudget = {
    ramBytes: 512,
    cpuMillis: 1000,
    environment: 3,
    model: 3,
    build: 3,
    review: 3,
    diskBytes: {},
    pools: { dockerRamBytes: 512 },
    measuredAt: now,
    maxAgeMs: 5000,
    accounts: {},
  };
  expect(resourceAdmissionReason(request, [holder], budget, now)).toBe('budget_ramBytes');
  budget.observedUsage = { live: { ramBytes: 300, cpuMillis: 0, pools: { dockerRamBytes: 300 } } };
  expect(resourceAdmissionReason(request, [holder], budget, now)).toBeUndefined();
  // A grant after this snapshot has no observation and must reserve its entire envelope.
  const pending: ResourceLease = {
    ...holder,
    id: 'not-observed',
    cost: { ...holder.cost, ramBytes: 200 },
  };
  expect(resourceAdmissionReason(request, [holder, pending], budget, now)).toBe('budget_ramBytes');
  budget.observedUsage.live!.ramBytes = 999999;
  budget.ramBytes = 299;
  expect(resourceAdmissionReason(request, [holder], budget, now)).toBe('budget_ramBytes');
  budget.ramBytes = null;
  expect(resourceAdmissionReason(request, [holder], budget, now)).toBe('unknown_ramBytes');
});
