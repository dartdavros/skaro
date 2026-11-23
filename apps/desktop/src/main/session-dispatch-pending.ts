import type { AppDb, OwnerCommand } from '@skaro/core';
import type { EventName, Events } from '../shared/ipc';
import type { TaskStartup } from './task-startup';

export function publishDispatchChange(
  emit: <E extends EventName>(event: E, payload: Events[E]) => void,
  command: OwnerCommand,
): void {
  emit('command.changed', command);
  if (command.method !== 'task.send' || ['accepted', 'delivering'].includes(command.state)) return;
  const [projectId, taskId] = command.args;
  if (typeof projectId === 'string' && typeof taskId === 'string')
    emit('task.changed', { projectId, taskId });
}

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
