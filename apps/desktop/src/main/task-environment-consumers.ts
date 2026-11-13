import type { TaskKey } from '@skaro/core';
import { checkoutKey } from './task-stage';
import type { TaskRunEngine } from './task-run-engine';

/** Exclude only the already-stopped review; an agent/integration using the same environment stays visible. */
export function busyTaskEnvironments(ctx: TaskRunEngine, stoppedReview?: TaskKey): TaskKey[] {
  const omitted = (key: TaskKey) =>
    stoppedReview?.projectId === key.projectId && stoppedReview.taskId === key.taskId;
  return [
    ...ctx.reviews.protectedEnvironments().filter((key) => !omitted(key)),
    ...[...ctx.active.values()].filter((active) => active.afterTurn).map(checkoutKey),
    ...ctx.queue.state().running.flatMap((key) => {
      const review = ctx.reviews.environment(key);
      if (review) return omitted(review) ? [] : [review];
      const active = ctx.active.get(key);
      const operation = ctx.integrations.operation(key);
      const [projectId, taskId] = key.split('\n') as [string, string];
      return [
        operation
          ? { projectId: operation.projectId, taskId: `integration-${operation.id}` }
          : active
            ? checkoutKey(active)
            : { projectId, taskId },
      ];
    }),
  ];
}
