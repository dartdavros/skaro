// Rules of a task's lifecycle shared by the board and its dialogs; no UI imports (unit-tested).

import type { TaskSummary } from '../../../shared/ipc';

/**
 * Starts now when launched; a blocked task waits for its dependencies instead. A task that
 * failed mid-work goes on from its feed ("Перезапустить"), not from here.
 */
export function canStart(task: TaskSummary): boolean {
  return task.status === 'todo' || task.status === 'cancelled' || task.stage === 'failed';
}
