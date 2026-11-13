import type { TaskRunEngine } from './task-run-engine';
import { isReviewQueueKey } from './task-environment-reviews';
import { resourcesFor } from './resource-execution';
import { CommandCancelled } from './owner-commands';
import { requireStartupGeneration } from './task-startup-generation';
import { requireIntegrationDispatch } from './integration-dispatch-fence';

export function resourceQueueSlots(ctx: TaskRunEngine) {
  const admitted = resourcesFor(ctx.deps.db)?.slots();
  if (admitted) return admitted;
  const { slots, running } = ctx.queue.state();
  return { total: slots, free: Math.max(0, slots - running.length) };
}

/** Queue identity is bound afresh; an unrelated completion must not lend its async owner scope. */
export async function executeResourceQueue(ctx: TaskRunEngine, key: string): Promise<void> {
  const [projectId, taskId] = key.split('\n') as [string, string];
  const review = isReviewQueueKey(key);
  const operation = ctx.integrations.operation(key);
  const ownerId = review
    ? `review:${taskId.slice(8)}`
    : operation
      ? `integration:${operation.id}`
      : `task:${taskId}`;
  const execute = async () => {
    if (review) return ctx.reviews.run(key);
    await ctx.reviews.ready();
    return operation ? ctx.integrations.run(operation) : ctx.scheduling.begin(key);
  };
  const resources = resourcesFor(ctx.deps.db);
  if (!resources) return execute();
  const epoch = ctx.startup.cancellationEpoch(projectId, taskId);
  const revision =
    !review && !operation ? ctx.startup.read(projectId, taskId)?.dispatchRevision : undefined;
  await resources
    .scope(projectId, ownerId, execute, {
      dispatchRevision: revision,
      requireCurrent: () => {
        if (!review && !operation) requireStartupGeneration(ctx.deps.db, projectId, revision);
        if (operation) requireIntegrationDispatch(ctx.deps.db, projectId, operation.id);
        if (
          ctx.closing ||
          (!review && !operation && ctx.startup.cancellationEpoch(projectId, taskId) !== epoch)
        )
          throw new CommandCancelled();
      },
    })
    .catch((error: unknown) => {
      if (
        error instanceof CommandCancelled ||
        (error instanceof Error && error.message === 'Stopped by owner')
      )
        return;
      throw error;
    });
}
