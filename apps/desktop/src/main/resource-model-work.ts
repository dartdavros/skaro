import { RESOURCE_CAPACITIES, type AppDb } from '@skaro/core';
import { resourceVolume } from './resource-budget';
import { resourceWorkCost } from './resource-policy';
import { resourceHolding } from './resource-holding';
import type { ApplicationResources } from './application-resources';
import { resourceExecution, type HeldResource } from './resource-execution';

/** Model and opaque worker commands start together, then return their capacities independently. */
export async function reserveModelWork(
  db: AppDb,
  dataDir: string,
  resources: ApplicationResources,
  account: string,
  needsWork: boolean,
): Promise<HeldResource & { work?: HeldResource }> {
  if (!needsWork) return resources.acquire('model', undefined, { account });
  const volume = await resourceVolume(dataDir);
  const model = resourceWorkCost(db, 'model', volume);
  const work = resourceWorkCost(db, 'build', volume);
  const project = db.getProject(resourceExecution.getStore()!.projectId);
  if (project) {
    const rootVolume = await resourceVolume(project.path);
    for (const cost of [model, work])
      if (Object.keys(cost.diskBytes).length)
        cost.diskBytes[rootVolume] ??= Math.max(...Object.values(cost.diskBytes));
  }
  const combined = { ...model, diskBytes: { ...work.diskBytes } };
  if (model.pools || work.pools) {
    combined.pools = { ...model.pools };
    for (const [pool, value] of Object.entries(work.pools ?? {}))
      combined.pools[pool] =
        (Object.hasOwn(combined.pools, pool) ? combined.pools[pool]! : 0) + value;
  }
  for (const key of RESOURCE_CAPACITIES) combined[key] += work[key];
  for (const [key, value] of Object.entries(model.diskBytes))
    combined.diskBytes[key] = (combined.diskBytes[key] ?? 0) + value;
  const parent = await resources.acquire('model', undefined, { account, cost: combined });
  try {
    const [modelLease, workLease] = db.admission.split(
      parent.lease.projectId,
      parent.lease.id,
      parent.lease.revision,
      [
        { checkpoint: 'model', cost: model },
        { checkpoint: 'worker-command-budget', cost: work },
      ],
    );
    return {
      ...resourceHolding(db, resources.manager, modelLease!),
      work: resourceHolding(db, resources.manager, workLease!),
    };
  } catch (error) {
    parent.release('worker_reservation_failed_before_dispatch');
    throw error;
  }
}
