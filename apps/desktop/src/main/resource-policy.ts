import type { AppDb, ResourceCost } from '@skaro/core';
import type { ResourceBudgetPolicy } from './resource-budget';

export type ResourceWork = 'worktree' | 'process' | 'model' | 'build' | 'environment' | 'review';
const MiB = 1024 ** 2;
export const RESOURCE_POLICY_KEY = 'resources.policy.v1';
const costs: Record<ResourceWork, Omit<ResourceCost, 'diskBytes'> & { disk: number }> = {
  worktree: {
    ramBytes: 128 * MiB,
    cpuMillis: 500,
    model: 0,
    environment: 0,
    build: 0,
    review: 0,
    disk: 512 * MiB,
  },
  process: {
    ramBytes: 512 * MiB,
    cpuMillis: 250,
    model: 0,
    environment: 0,
    build: 0,
    review: 0,
    disk: 128 * MiB,
  },
  model: {
    ramBytes: 128 * MiB,
    cpuMillis: 250,
    model: 1,
    environment: 0,
    build: 0,
    review: 0,
    disk: 0,
  },
  build: {
    ramBytes: 512 * MiB,
    cpuMillis: 1000,
    model: 0,
    environment: 0,
    build: 1,
    review: 0,
    disk: 512 * MiB,
  },
  environment: {
    ramBytes: 1024 * MiB,
    cpuMillis: 1000,
    model: 0,
    environment: 1,
    build: 0,
    review: 0,
    disk: 1024 * MiB,
  },
  review: { ramBytes: 0, cpuMillis: 0, model: 0, environment: 0, build: 0, review: 1, disk: 0 },
};

/** Explicit, persisted policy overrides. Missing host measurements are never replaced with defaults. */
export function applicationResourcePolicy(db: AppDb): ResourceBudgetPolicy {
  const configured = db.getSetting<Partial<ResourceBudgetPolicy>>(RESOURCE_POLICY_KEY, {});
  return {
    reserveRamBytes: 1024 * MiB,
    reserveDiskBytes: 1024 * MiB,
    reserveCpuMillis: 500,
    model: Number(db.getSetting('runs.slots', 3)) || 3,
    environment: 3,
    build: 3,
    review: 3,
    accounts: {},
    ...configured,
  };
}

export function resourceWorkCost(
  db: Pick<AppDb, 'getSetting'>,
  kind: ResourceWork,
  volume: string,
): ResourceCost {
  const overrides = db.getSetting<
    Partial<Record<ResourceWork, Partial<(typeof costs)[ResourceWork]>>>
  >('resources.costs.v1', {});
  const { disk, ...cost } = { ...costs[kind], ...overrides[kind] };
  return { ...cost, diskBytes: disk ? { [volume]: disk } : {} };
}
