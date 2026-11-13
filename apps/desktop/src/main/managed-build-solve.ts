import { join } from 'node:path';
import type { ManagedBuilder, ManagedCacheStore } from './managed-cache-store';
import type { ManagedBuildSource } from './managed-build-source';
import { cacheTree, readCacheFile } from './managed-cache-files';
import { managedCacheCommand } from './managed-cache-command';
import { builderDirectory, builderEnvironment, inspectBuilder } from './managed-buildkit-identity';
import {
  managedBuildHash,
  validateManagedDockerfile,
  unsupportedManagedBuild,
} from './managed-build-recipe';
import {
  managedBuildNetwork,
  managedRunResourceArguments,
  verifyManagedBuildHost,
  verifyManagedRunPlan,
  type ManagedBuildApproval,
} from './managed-build-profile';
import { resourceExecution } from './resource-execution';

import { managedBuildProgress } from './managed-build-progress';

/** Execute the unmodified frozen recipe only under the caller's admitted exclusive cleanup fence. */
export async function solveManagedBuild(
  store: ManagedCacheStore,
  entry: ManagedBuilder,
  context: string,
  sourceCwd: string,
  source: ManagedBuildSource,
  contextDigest: string,
  approval?: ManagedBuildApproval,
) {
  const scope = resourceExecution.getStore();
  if (!scope?.resources || scope.projectId !== entry.projectId)
    throw new Error('managed_cache_resource_admission_required');
  const network = managedBuildNetwork(entry.projectId, sourceCwd, source, approval);
  const recipeBytes = (await readCacheFile(store.root, join(context, 'Dockerfile'), 128 * 1024))
    .data;
  if (managedBuildHash(recipeBytes) !== source.recipeDigest)
    unsupportedManagedBuild('recipe_changed');
  const recipe = validateManagedDockerfile(recipeBytes.toString('utf8'));
  const runs = recipe.instructions
    .filter((instruction) => instruction.name === 'RUN')
    .map((instruction) => instruction.body);
  const common = [
    'buildx',
    'build',
    '--builder',
    entry.name,
    '--file',
    join(context, 'Dockerfile'),
    '--platform=linux/amd64',
    '--provenance=false',
    '--sbom=false',
    `--network=${network}`,
    ...(source.base === 'scratch' ? [] : managedRunResourceArguments()),
  ];
  const options = {
    cwd: builderDirectory(store, entry.projectId),
    env: await builderEnvironment(store, entry),
  };
  async function current() {
    await scope!.requireCurrent();
    if ((await cacheTree(store.root, context)).digest !== contextDigest)
      unsupportedManagedBuild('frozen_context_changed');
    await inspectBuilder(store, entry);
  }
  await current();
  verifyManagedBuildHost(
    JSON.parse(
      await managedCacheCommand(entry.client!.docker, ['info', '--format', '{{json .}}'], options),
    ),
  );
  let runPlan: { digest: string; runs: ReturnType<typeof verifyManagedRunPlan> } | undefined;
  if (source.base !== 'scratch') {
    // Frontends may silently omit unsupported resource constraints: inspect the actual LLB first.
    store.db.resources.cleanup.effect(entry.resourceId, true);
    const plan = await managedCacheCommand(
      entry.client!.docker,
      [...common, '--call=convertllb,format=json', '--progress=quiet', context],
      {
        ...options,
        maxOutput: 4 * 1024 ** 2,
        failed: () => new Error('managed_build_run_plan_command_failed'),
      },
    );
    store.db.resources.cleanup.externalSettled(entry.resourceId);
    try {
      runPlan = {
        digest: managedBuildHash(plan),
        runs: verifyManagedRunPlan(JSON.parse(plan), runs.length),
      };
      store.outcome(entry, 'observed', 'managed_buildkit_run_resource_plan_verified');
    } catch (error) {
      store.outcome(entry, 'failed', 'managed_buildkit_run_resource_plan_rejected');
      throw error;
    }
    await current();
  }
  const progress = managedBuildProgress(runs);
  store.db.resources.cleanup.effect(entry.resourceId, true);
  await managedCacheCommand(
    entry.client!.docker,
    [...common, '--output=type=cacheonly', '--progress=rawjson', context],
    {
      ...options,
      stderr: progress.accept,
      failed: () => new Error('managed_build_solve_command_failed'),
      started: (pid, birth) => {
        entry.consumer = { intent: scope.intentId, pid, ...(birth ? { birth } : {}) };
        store.saveBuilder(entry);
      },
    },
  );
  store.db.resources.cleanup.externalSettled(entry.resourceId);
  await current();
  return {
    runSteps: progress.finish(),
    network,
    output: 'cacheonly-no-deploy-image' as const,
    ...(runPlan ? { runPlan } : {}),
  };
}
