import { expect, it } from 'vitest';
import type { ResourceBudget, ResourceLease } from './admission-model.ts';
import { resourceAdmissionReason } from './admission-policy.ts';

it('keeps capacity observations informational for host, Docker, slots and stale metrics', () => {
  const now = Date.now();
  const request: ResourceLease = {
    id: 'next',
    projectId: 'project',
    ownerId: 'environment:next',
    intentId: 'next',
    checkpoint: 'start',
    cost: {
      ramBytes: 300,
      cpuMillis: 300,
      model: 0,
      environment: 1,
      build: 0,
      review: 0,
      diskBytes: {},
      pools: { dockerRamBytes: 300, dockerCpuMillis: 300 },
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
    cost: {
      ...request.cost,
      ramBytes: 400,
      cpuMillis: 400,
      pools: { dockerRamBytes: 400, dockerCpuMillis: 400 },
    },
  };
  const budget: ResourceBudget = {
    ramBytes: 512,
    cpuMillis: 512,
    environment: 3,
    model: 3,
    build: 3,
    review: 3,
    diskBytes: {},
    pools: { dockerRamBytes: 512, dockerCpuMillis: 512 },
    measuredAt: now,
    maxAgeMs: 5000,
    accounts: {},
  };
  expect(resourceAdmissionReason(request, [holder], budget, now)).toBeUndefined();
  budget.observedUsage = {
    live: { ramBytes: 300, cpuMillis: 300, pools: { dockerRamBytes: 300, dockerCpuMillis: 300 } },
  };
  expect(resourceAdmissionReason(request, [holder], budget, now)).toBeUndefined();
  // A grant after this snapshot has no observation and must reserve its entire envelope.
  const pending: ResourceLease = {
    ...holder,
    id: 'not-observed',
    cost: { ...holder.cost, ramBytes: 200, cpuMillis: 200 },
  };
  expect(resourceAdmissionReason(request, [holder, pending], budget, now)).toBeUndefined();
  for (const ramBytes of [0, null]) {
    budget.ramBytes = ramBytes;
    budget.pools!.dockerRamBytes = ramBytes;
    expect(resourceAdmissionReason(request, [holder], budget, now)).toBeUndefined();
  }
  delete budget.pools!.dockerRamBytes;
  expect(resourceAdmissionReason(request, [holder], budget, now)).toBeUndefined();
  const olderRamOnly: ResourceLease = {
    ...holder,
    state: 'waiting_resource',
    reason: 'budget_ramBytes',
    cost: { ...holder.cost, cpuMillis: 0, environment: 0, pools: { dockerRamBytes: 999999 } },
  };
  expect(resourceAdmissionReason(request, [olderRamOnly], budget, now)).toBeUndefined();
  budget.observedUsage.live!.cpuMillis = 999999;
  budget.cpuMillis = 299;
  expect(resourceAdmissionReason(request, [holder], budget, now)).toBeUndefined();
  budget.measuredAt = 0;
  budget.cpuMillis = null;
  expect(resourceAdmissionReason(request, [holder], budget, now)).toBeUndefined();
});
