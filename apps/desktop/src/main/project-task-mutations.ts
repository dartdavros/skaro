import type { AppDb } from '@skaro/core';
import type { ProjectContext } from './projects';

import { TaskMutationQueue } from './task-mutation-queue';

const queues = new WeakMap<ProjectContext, TaskMutationQueue>();
function queue(context: ProjectContext) {
  let current = queues.get(context);
  if (!current) queues.set(context, (current = new TaskMutationQueue()));
  return current;
}
export function cleanTaskCheckout(
  context: ProjectContext,
  owners: () => Set<string>,
  action: () => Promise<void>,
) {
  return queue(context).clean(owners, () => {
    context.assertTasksMutable();
    return action();
  });
}
export function mutateTaskOwner<T>(
  context: ProjectContext,
  owner: string,
  action: () => Promise<T>,
) {
  return queue(context).run(() => {
    context.assertTasksMutable();
    return action();
  }, owner);
}
export const taskReplanLockKey = (projectId: string) => `task.replan-lock.${projectId}`;

/** Task graph writes and new task launches share this short-lived gate. */
export function serializeTaskMutation<T>(
  context: ProjectContext,
  action: () => Promise<T>,
  recovery = false,
): Promise<T> {
  return queue(context).run(() => {
    if (!recovery) context.assertTasksMutable();
    return action();
  });
}

export function assertTaskGraphAvailable(db: AppDb, projectId: string): void {
  if (db.getSetting<string | null>(taskReplanLockKey(projectId), null)) {
    throw new Error(
      'Task replanning is being applied or recovering. Open its project chat to finish it before changing or starting tasks.',
    );
  }
}
