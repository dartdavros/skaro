import type { AppDb } from '@skaro/core';
import { applicationResourcePolicy } from './resource-policy';
import { measureResourceBudget, resourceVolume } from './resource-budget';
import { dockerResourceBudget } from './resource-docker-budget';

/** Account observations and host/VM adapters feed one application-wide capacity snapshot. */
export async function applicationResourceMeasurements(
  db: AppDb,
  accounts: ReadonlySet<string>,
  paths: ReadonlySet<string>,
  useDocker: boolean,
) {
  const policy = applicationResourcePolicy(db);
  for (const account of accounts)
    if (!Object.hasOwn(policy.accounts, account))
      policy.accounts[account] = { slots: policy.model, blocked: false };
  for (const [account, observation] of Object.entries(
    db.getSetting<Record<string, { exhausted: boolean; reset?: number }>>(
      'resources.accountLimits',
      {},
    ),
  )) {
    if (observation.exhausted && (!observation.reset || observation.reset > Date.now())) {
      policy.accounts[account] ??= { slots: policy.model, blocked: false };
      policy.accounts[account].blocked = true;
    }
  }
  const measuredAt = Date.now();
  const docker = useDocker
    ? await dockerResourceBudget(
        db.getSetting<string | undefined>('resources.dockerDataPath', undefined),
      )
    : undefined;
  const budget = await measureResourceBudget(policy, [
    ...paths,
    ...(docker?.storage ? [docker.storage] : []),
  ]);
  budget.measuredAt = measuredAt;
  if (docker) budget.pools = docker.pools;
  if (docker?.storage)
    budget.poolVolumes = { dockerDiskBytes: await resourceVolume(docker.storage) };
  return budget;
}
