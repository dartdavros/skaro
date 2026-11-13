import { availableParallelism, cpus, freemem } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { realpath, stat, statfs } from 'node:fs/promises';
import type { ResourceBudget } from '@skaro/core';

export interface ResourceBudgetPolicy {
  reserveRamBytes: number;
  reserveDiskBytes: number;
  reserveCpuMillis: number;
  model: number;
  environment: number;
  build: number;
  review: number;
  accounts: ResourceBudget['accounts'];
}

/** Actual device identity avoids treating two paths on C: as two independent disks. */
export async function resourceVolume(path: string): Promise<string> {
  const canonical = await realpath(path);
  return String((await stat(canonical, { bigint: true })).dev);
}

export async function measureResourceBudget(
  policy: ResourceBudgetPolicy,
  paths: readonly string[],
): Promise<ResourceBudget> {
  for (const key of [
    'reserveRamBytes',
    'reserveDiskBytes',
    'reserveCpuMillis',
    'model',
    'environment',
    'build',
    'review',
  ] as const)
    if (!Number.isSafeInteger(policy[key]) || policy[key] < 0)
      throw new Error('Invalid resource budget policy');
  const diskBytes: ResourceBudget['diskBytes'] = {};
  for (const path of paths) {
    let volume: string;
    try {
      volume = await resourceVolume(path);
    } catch {
      continue;
    } // No identity means no budget for that disk, not zero usage or a global outage.
    try {
      const fs = await statfs(await realpath(path), { bigint: true });
      const free = fs.bavail * fs.bsize;
      const value =
        free > BigInt(Number.MAX_SAFE_INTEGER)
          ? null
          : Math.max(0, Number(free) - policy.reserveDiskBytes);
      diskBytes[volume] =
        diskBytes[volume] === null || value === null
          ? null
          : Math.min(diskBytes[volume] ?? value, value);
    } catch {
      diskBytes[volume] = null;
    }
  }
  const before = cpus();
  await delay(100);
  const after = cpus();
  const idle = measuredIdleCpu(
    before.map((c) => c.times),
    after.map((c) => c.times),
    availableParallelism(),
  );
  const memory = freemem();
  return {
    ramBytes:
      Number.isSafeInteger(memory) && memory >= 0
        ? Math.max(0, memory - policy.reserveRamBytes)
        : null,
    cpuMillis: idle === null ? null : Math.max(0, idle - policy.reserveCpuMillis),
    model: policy.model,
    environment: policy.environment,
    build: policy.build,
    review: policy.review,
    diskBytes,
    accounts: structuredClone(policy.accounts),
    measuredAt: Date.now(),
    maxAgeMs: 5000,
  };
}

/** CPU availability is sampled idle time, bounded by this process's actual CPU allocation. */
export function measuredIdleCpu(
  before: ReadonlyArray<{ idle: number; user: number; nice: number; sys: number; irq: number }>,
  after: typeof before,
  parallelism: number,
): number | null {
  if (!before.length || before.length !== after.length) return null;
  let total = 0,
    idle = 0;
  for (const [i, current] of after.entries()) {
    for (const key of ['idle', 'user', 'nice', 'sys', 'irq'] as const) {
      const delta = current[key] - before[i]![key];
      if (!Number.isFinite(delta) || delta < 0) return null;
      total += delta;
      if (key === 'idle') idle += delta;
    }
  }
  return total > 0 ? Math.floor((parallelism * 1000 * idle) / total) : null;
}
