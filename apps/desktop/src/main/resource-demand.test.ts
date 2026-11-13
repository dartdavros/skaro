import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { measuredEnvironmentCost } from './resource-environment-cost';
import { resourceWorkCost } from './resource-policy';
import { measuredIdleCpu, measureResourceBudget } from './resource-budget';
import { dockerMemory } from './resource-docker-observation';

it('uses one cold environment envelope and measured consumption instead of per-service limits', () => {
  const db = AppDb.open(':memory:');
  try {
    const baseline = resourceWorkCost(db, 'environment', 'volume');
    const cold = measuredEnvironmentCost(baseline, []);
    expect(cold.ramBytes).toBe(1024 ** 3);
    expect(cold.cpuMillis).toBe(1000);
    const small = Array.from({ length: 16 }, (_, n) => ({
      id: String(n),
      ramBytes: 16 * 1024 ** 2,
      cpuMillis: 10,
    }));
    expect(measuredEnvironmentCost(baseline, small)).toEqual(cold);
    const observed = measuredEnvironmentCost(baseline, [
      { id: 'measured', ramBytes: 2 * 1024 ** 3, cpuMillis: 1200 },
    ]);
    expect(observed.ramBytes).toBe(2.5 * 1024 ** 3);
    expect(observed.cpuMillis).toBe(1500);
    expect(observed.pools?.dockerRamBytes).toBe(observed.ramBytes);
    expect(baseline.pools).toBeUndefined();
  } finally {
    db.close();
  }
});

it('counts sampled idle CPU instead of treating every logical CPU as free', () => {
  const before = [{ idle: 0, user: 0, nice: 0, sys: 0, irq: 0 }];
  expect(measuredIdleCpu(before, [{ idle: 25, user: 75, nice: 0, sys: 0, irq: 0 }], 4)).toBe(1000);
  expect(measuredIdleCpu(before, [{ idle: 0, user: 100, nice: 0, sys: 0, irq: 0 }], 4)).toBe(0);
  expect(measuredIdleCpu(before, before, 4)).toBeNull();
  expect(measuredIdleCpu([], [], 4)).toBeNull();
  expect(dockerMemory('128MiB')).toBe(128 * 1024 ** 2);
  expect(dockerMemory('1.5GiB')).toBe(1.5 * 1024 ** 3);
});

it('collects a fresh real host budget without Docker or fabricated metrics', async () => {
  const start = Date.now();
  const budget = await measureResourceBudget(
    {
      reserveRamBytes: 1024 ** 3,
      reserveCpuMillis: 500,
      reserveDiskBytes: 1024 ** 3,
      model: 3,
      build: 3,
      review: 3,
      environment: 3,
      accounts: {},
    },
    [process.cwd()],
  );
  expect(budget.measuredAt).toBeGreaterThanOrEqual(start);
  expect(budget.ramBytes).toBeGreaterThanOrEqual(0);
  expect(budget.cpuMillis === null || budget.cpuMillis >= 0).toBe(true);
  expect(Object.values(budget.diskBytes)).toHaveLength(1);
});
