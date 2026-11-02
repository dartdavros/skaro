import { expect, it } from 'vitest';
import { requireTaskNotStopping } from './builtin-task-stop';
import { CommandCancelled } from './owner-commands';

it('cancels delivery during stop and refuses reuse after unconfirmed shutdown', () => {
  // Pure admission state only; no task/run, session or backend is substituted.
  expect(() => requireTaskNotStopping({})).not.toThrow();
  expect(() => requireTaskNotStopping({ stopping: Promise.resolve() })).toThrow(CommandCancelled);
  expect(() => requireTaskNotStopping({ stopError: 'OS exit was not confirmed' })).toThrow(
    'OS exit was not confirmed',
  );
  expect(() =>
    requireTaskNotStopping({ stopping: Promise.resolve(), stopError: 'OS exit was not confirmed' }),
  ).toThrow('OS exit was not confirmed');
});
