import type { AppDb, ResourceCost } from '@skaro/core';
import type { EnvironmentDescription } from './task-environment-description';
import { resourceVolume } from './resource-budget';
import { resourceWorkCost } from './resource-policy';
import { readCompose } from './task-compose';

/** Canonical Compose limits bound known services; every unlimited service gets its own fallback. */
export async function environmentResourceCost(
  db: Pick<AppDb, 'getSetting'>,
  dataDir: string,
  description: EnvironmentDescription,
): Promise<ResourceCost> {
  const cost = resourceWorkCost(db, 'environment', await resourceVolume(dataDir));
  if (!description.compose) return cost;
  const model = await readCompose(description.identity.worktree, description.compose.baseVariables);
  const baseline = { ...cost };
  let ram = 0,
    cpu = 0;
  for (const service of Object.values(model.services)) {
    const deploy = service.deploy as
      | {
          replicas?: number;
          resources?: { limits?: { memory?: string | number; cpus?: string | number } };
        }
      | undefined;
    const scale = Number(service.scale ?? deploy?.replicas ?? 1);
    if (!Number.isSafeInteger(scale) || scale < 0) throw new Error('Unknown Compose replica cost');
    const memory = Number(service.mem_limit ?? deploy?.resources?.limits?.memory);
    const cores = Number(service.cpus ?? deploy?.resources?.limits?.cpus);
    ram += scale * (Number.isSafeInteger(memory) && memory > 0 ? memory : baseline.ramBytes);
    cpu +=
      scale * (Number.isFinite(cores) && cores > 0 ? Math.ceil(cores * 1000) : baseline.cpuMillis);
  }
  const configured = db.getSetting<{ environment?: Partial<ResourceCost> }>(
    'resources.costs.v1',
    {},
  ).environment;
  cost.ramBytes = configured?.ramBytes ?? ram;
  cost.cpuMillis = configured?.cpuMillis ?? cpu;
  cost.pools = {
    dockerRamBytes: cost.ramBytes,
    dockerCpuMillis: cost.cpuMillis,
    dockerDiskBytes: Math.max(0, ...Object.values(cost.diskBytes)),
  };
  return cost;
}
