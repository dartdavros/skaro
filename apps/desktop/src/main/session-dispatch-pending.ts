import type { AppDb } from '@skaro/core';
import type { TaskStartup } from './task-startup';

/** Native acknowledgement and model activity are later than acceptance into the durable inbox. */
export function ownerDispatchPending(
  db: Pick<AppDb, 'commands'>,
  projectId: string,
  ownerId: string,
): boolean {
  return db.commands.hasPendingInput(`${projectId}:${ownerId}`);
}

export function taskDispatchPending(
  db: Pick<AppDb, 'commands'>,
  startup: ReturnType<TaskStartup['read']>,
  projectId: string,
  taskId: string,
): boolean {
  // The scheduler also owns teardown after the last native turn. Only undelivered input counts.
  return (
    ownerDispatchPending(db, projectId, taskId) || (!!startup?.inputs.length && !startup.error)
  );
}
