import { describe, expect, it } from 'vitest';
import type { ResourceLease } from '@skaro/core';
import { sameInitializationLease } from './cache-buildkit-initialization';

describe('unused BuildKit initialization reservation identity', () => {
  const original: ResourceLease = {
    id: 'reservation',
    projectId: 'registered-project',
    ownerId: 'managed-cache:buildkit',
    intentId: 'failed-dispatch',
    checkpoint: 'managed-cache-buildkit',
    revision: 3,
    sequence: 1,
    state: 'retained',
    reason: 'external_state_requires_reconciliation',
    createdAt: 1,
    updatedAt: 2,
    locks: [{ resourceId: 'source', generation: 1, mode: 'shared' }],
    cost: {
      ramBytes: 1024,
      cpuMillis: 500,
      model: 0,
      environment: 1,
      build: 1,
      review: 0,
      diskBytes: {},
    },
  };
  const released: ResourceLease = {
    ...original,
    state: 'released',
    revision: 4,
    updatedAt: 3,
    reason: 'teardown_confirmed',
    evidence: 'buildkit_initialization_no_dispatch_native_and_docker_proven',
  };

  it('allows only the exact original or its single evidenced release transition', () => {
    expect(() => sameInitializationLease(structuredClone(original), original)).not.toThrow();
    expect(() => sameInitializationLease(released, original)).not.toThrow();
    for (const changed of [
      { ...released, evidence: 'pid_exited' },
      { ...released, revision: 5 },
      { ...released, reason: 'expired' },
      { ...released, updatedAt: 0 },
      { ...released, locks: [] },
      { ...released, cost: { ...released.cost, build: 0 } },
      { ...original, updatedAt: 3 },
      { ...released, intentId: 'other-attempt' },
    ])
      expect(() => sameInitializationLease(changed, original)).toThrow();
  });
});
