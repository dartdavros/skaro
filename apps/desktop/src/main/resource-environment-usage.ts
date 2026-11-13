import { ownsResourceCapacity, type AppDb, type ResourceBudget } from '@skaro/core';
import type { LocalVersionTarget } from '../shared/local-versions';
import type { DockerUsage } from './resource-docker-observation';

/** Credit measured containers once, against their registered task/integration/local environment lease. */
export function observedEnvironmentUsage(
  db: Pick<AppDb, 'admission' | 'resources' | 'collections'>,
  usage: readonly DockerUsage[],
): NonNullable<ResourceBudget['observedUsage']> {
  const observed: NonNullable<ResourceBudget['observedUsage']> = {};
  const credited = new Set<string>();
  for (const lease of db.admission.all()) {
    if (!ownsResourceCapacity(lease)) continue;
    const target = lease.ownerId.startsWith('local-environment:')
      ? db.collections
          .all<LocalVersionTarget>(`coordination.local-targets.${lease.projectId}`)
          .find(
            (t) => lease.ownerId === `local-environment:${t.id}` && t.projectId === lease.projectId,
          )
      : undefined;
    const resource = db.resources
      .list(lease.projectId)
      .find(
        (r) =>
          r.kind === 'environment' &&
          r.ownership === 'registered' &&
          (target
            ? r.id === target.resourceId
            : ['task', 'integration'].includes(r.owner.kind) &&
              lease.ownerId === `environment:${r.owner.id}`),
      );
    if (!resource) continue;
    const rows = usage.filter(
      (u) =>
        !credited.has(u.id) &&
        u.project === resource.identity.composeProject &&
        resource.objectIds?.includes(u.id),
    );
    if (!rows.length) continue;
    for (const row of rows) credited.add(row.id);
    const ramBytes = rows.reduce((n, u) => n + u.ramBytes, 0);
    const cpuMillis = rows.reduce((n, u) => n + u.cpuMillis, 0);
    observed[lease.id] = {
      ramBytes,
      cpuMillis,
      pools: { dockerRamBytes: ramBytes, dockerCpuMillis: cpuMillis },
    };
  }
  return observed;
}
