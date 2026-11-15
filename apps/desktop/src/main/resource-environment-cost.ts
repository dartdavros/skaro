import type { AppDb, ResourceCost } from '@skaro/core';
import type { EnvironmentDescription } from './task-environment-description';
import { resourceVolume } from './resource-budget';
import { resourceWorkCost } from './resource-policy';
import type { DockerUsage } from './resource-docker-observation';

/** One environment estimate, with growth headroom over observed consumption, never limits. */
export function measuredEnvironmentCost(
  baseline: ResourceCost,
  usage: readonly DockerUsage[],
): ResourceCost {
  const cost = structuredClone(baseline);
  if (usage.length) {
    cost.ramBytes = Math.max(
      cost.ramBytes,
      Math.ceil(usage.reduce((n, u) => n + u.ramBytes, 0) * 1.25),
    );
    cost.cpuMillis = Math.max(
      cost.cpuMillis,
      Math.ceil(usage.reduce((n, u) => n + u.cpuMillis, 0) * 1.25),
    );
  }
  cost.pools = {
    dockerRamBytes: cost.ramBytes,
    dockerCpuMillis: cost.cpuMillis,
    dockerDiskBytes: Math.max(0, ...Object.values(cost.diskBytes)),
  };
  return cost;
}

export async function environmentResourceCost(
  db: Pick<AppDb, 'getSetting' | 'resources'>,
  dataDir: string,
  _description: EnvironmentDescription,
  _projectId: string,
): Promise<ResourceCost> {
  const baseline = resourceWorkCost(db, 'environment', await resourceVolume(dataDir));
  // No host/Docker observations are prerequisites for authorized environment dispatch.
  return measuredEnvironmentCost(baseline, []);
}
