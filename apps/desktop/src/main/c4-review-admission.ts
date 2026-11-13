import { resourceWorkCost } from './resource-policy';
import { resourceVolume } from './resource-budget';
import { resourceHolding } from './resource-holding';
import { resourcesFor } from './resource-execution';
import { RESOURCE_CAPACITIES, type AppDb } from '@skaro/core';
import type { C4SemanticJob } from './c4-semantic-store';

/** Reserve model+process atomically before spawning, so quota wait cannot retain a reviewer OS process. */
export async function c4ReviewAdmission(
  db: AppDb,
  dataDir: string,
  job: C4SemanticJob,
  requireCurrent: () => Promise<void>,
) {
  const resources = resourcesFor(db);
  if (!resources) throw new Error('C4 review requires the real resource dispatcher');
  if (!job.worker) throw new Error('C4 reviewer identity must be saved before admission');
  const volume = await resourceVolume(dataDir),
    model = resourceWorkCost(db, 'model', volume),
    process = resourceWorkCost(db, 'process', volume);
  const combined = { ...model, diskBytes: { ...model.diskBytes } };
  if (model.pools || process.pools) {
    combined.pools = { ...model.pools };
    for (const [pool, value] of Object.entries(process.pools ?? {}))
      combined.pools[pool] = (combined.pools[pool] ?? 0) + value;
  }
  for (const key of RESOURCE_CAPACITIES) combined[key] += process[key];
  for (const [key, value] of Object.entries(process.diskBytes))
    combined.diskBytes[key] = (combined.diskBytes[key] ?? 0) + value;
  const parent = await resources.acquire('model', undefined, {
    account: `managed:${db.getRun(job.runId)!.agent}`,
    cost: combined,
  });
  let split;
  try {
    split = db.admission.split(job.projectId, parent.lease.id, parent.lease.revision, [
      { checkpoint: 'c4-review-model', cost: model },
      { checkpoint: `process:${job.worker}`, cost: process },
    ]);
  } catch (error) {
    parent.release('review_not_spawned');
    throw error;
  }
  const modelLease = resourceHolding(db, resources.manager, split[0]!),
    processLease = resourceHolding(db, resources.manager, split[1]!);
  try {
    await requireCurrent();
    processLease.bind([
      {
        resourceId: job.observation.resource.id,
        generation: job.observation.resource.generation,
        mode: 'shared',
      },
    ]);
  } catch (error) {
    modelLease.release('review_not_spawned');
    processLease.release('review_not_spawned');
    throw error;
  }
  let modelUsed = false,
    processUsed = false;
  return {
    admission: {
      process: async (signal: AbortSignal) => {
        signal.throwIfAborted();
        await requireCurrent();
        if (processUsed) throw new Error('C4 reviewer process permit already consumed');
        processUsed = true;
        return processLease;
      },
      turn: async (signal: AbortSignal) => {
        signal.throwIfAborted();
        await requireCurrent();
        if (modelUsed) throw new Error('C4 review permits one model turn');
        modelUsed = true;
        return modelLease;
      },
      limits: (state: 'ok' | 'warning' | 'exhausted', resetsAt?: string) =>
        resources.observeQuota(`managed:${db.getRun(job.runId)!.agent}`, state, resetsAt),
    },
    release: () => {
      modelLease.release('c4_review_process_exit_confirmed');
      processLease.release('c4_review_process_exit_confirmed');
    },
  };
}
