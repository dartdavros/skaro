import type { AppDb } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { key } from './task-run-helpers';

/** Native acknowledgement and model activity are later than acceptance into the durable inbox. */
export function ownerDispatchPending(db: AppDb, projectId: string, ownerId: string): boolean {
  return db.commands.hasPendingInput(`${projectId}:${ownerId}`);
}

export function taskDispatchPending(
  ctx: TaskRunEngine,
  projectId: string,
  taskId: string,
): boolean {
  const startup = ctx.startup.read(projectId, taskId);
  return (
    ownerDispatchPending(ctx.deps.db, projectId, taskId) ||
    (!!startup?.inputs.length && !startup.error) ||
    ctx.queue.state().running.includes(key(projectId, taskId))
  );
}
