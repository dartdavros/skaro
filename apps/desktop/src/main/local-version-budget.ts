import type { AppDb } from '@skaro/core';
import type { LocalVersionTarget } from '../shared/local-versions';
import type { inspectLocalTarget } from './local-version-target';
import { environmentResourceCost } from './resource-environment-cost';
import { resourceExecution, resourcesFor } from './resource-execution';

/** The permanent environment outlives the installation command and keeps its own runtime budget. */
export async function localVersionBudget(
  db: AppDb,
  dataDir: string,
  target: LocalVersionTarget,
  observed: Awaited<ReturnType<typeof inspectLocalTarget>>,
) {
  const resources = resourcesFor(db),
    scope = resourceExecution.getStore();
  if (!resources || !scope) throw new Error('Local environment requires resource scope');
  const ownerId = `local-environment:${target.id}`;
  if (resources.holdings(target.projectId, ownerId).length) return;
  const cost = await environmentResourceCost(
    db,
    dataDir,
    {
      identity: {
        root: observed.root,
        worktree: observed.root,
        name: observed.resource.identity.composeProject!,
        ports: {},
      },
      variables: observed.variables,
      compose: { variables: observed.variables, baseVariables: observed.variables, override: '' },
    },
    target.projectId,
  );
  await resources.acquire(
    'environment',
    { ...scope, ownerId },
    { cost, checkpoint: `local-environment:${target.id}` },
  );
}
