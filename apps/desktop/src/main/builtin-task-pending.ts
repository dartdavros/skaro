import { isDeepStrictEqual } from 'node:util';
import type { BuiltinTaskStart } from './builtin-task-start';
import { CommandCancelled } from './owner-commands';
import type { TaskStartup } from './task-startup';

/** Cancellation or replacement of a durable selection cannot fall back to a managed agent. */
export function requirePendingBuiltinStart(
  current: BuiltinTaskStart | undefined,
  expected: BuiltinTaskStart,
  closing = false,
) {
  if (closing || !isDeepStrictEqual(current, expected)) throw new CommandCancelled();
}

/** A cancelled attempt cannot become current again when the same choices are selected later. */
export function capturePendingBuiltinStart(
  startup: TaskStartup,
  projectId: string,
  taskId: string,
  closing: () => boolean,
) {
  const expected = startup.read(projectId, taskId);
  if (!expected?.builtin || !expected.builtinAttempt) throw new CommandCancelled();
  return () => {
    const current = startup.read(projectId, taskId);
    if (current?.builtinAttempt !== expected.builtinAttempt) throw new CommandCancelled();
    requirePendingBuiltinStart(current?.builtin, expected.builtin!, closing());
  };
}
