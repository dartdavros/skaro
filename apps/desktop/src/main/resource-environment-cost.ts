import type { AppDb, ResourceCost } from '@skaro/core';
import type { EnvironmentDescription } from './task-environment-description';
import { resourceVolume } from './resource-budget';
import { resourceWorkCost } from './resource-policy';
import { observeDockerResources, type DockerUsage } from './resource-docker-observation';

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
  description: EnvironmentDescription,
  projectId: string,
): Promise<ResourceCost> {
  const baseline = resourceWorkCost(db, 'environment', await resourceVolume(dataDir));
  if (!description.compose) return baseline;
  const source = description.config?.source;
  const registered = db.resources.list(projectId);
  const candidates = new Set([
    description.identity.name,
    ...(source ? [source.project] : []),
    ...registered
      .filter(
        (r) =>
          r.kind === 'environment' && r.purpose === 'project-dev' && r.ownership === 'registered',
      )
      .map((r) => r.identity.composeProject),
  ]);
  const { usage } = await observeDockerResources();
  for (const project of candidates) {
    const observed = usage.filter(
      (u) =>
        u.project === project &&
        (project !== source?.project || !source || source.services.includes(u.service ?? '')),
    );
    if (observed.length) return measuredEnvironmentCost(baseline, observed);
  }
  // Cold starts reserve the configured envelope once. Unknown services do not multiply it.
  return measuredEnvironmentCost(baseline, []);
}
