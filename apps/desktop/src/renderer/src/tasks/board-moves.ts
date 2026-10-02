// What dragging a card between the board's columns does: a column is the task's status, so a
// move to another column is an action on the task, and only these are allowed.

import type { TaskSummary } from '../../../shared/ipc';
import type { Column } from './model';
import { canStart } from './task-rules';

export type ColumnKey = Column['key'];

/**
 * - within a column — only the order changes;
 * - "Не начата" → "В работе" — start (the launch dialog; a blocked task cannot start);
 * - "В работе" → "Не начата" — the agent stops, the task waits for a new start;
 * - "На ревью" → "Готово" — merge, as "Влить" on the merge card.
 * Nothing goes to "На ревью" by hand: the agent sends a task there when its criteria are met.
 */
export type Move = 'reorder' | 'start' | 'cancel' | 'merge';

export function moveOf(task: TaskSummary, from: ColumnKey, to: ColumnKey): Move | undefined {
  if (from === to) return 'reorder';
  if (from === 'todo' && to === 'working')
    return canStart(task) && task.waitsFor.length === 0 && task.status !== 'blocked'
      ? 'start'
      : undefined;
  if (from === 'working' && to === 'todo')
    return task.stage === 'in_progress' ? 'cancel' : undefined;
  if (from === 'review' && to === 'done') return task.status === 'review' ? 'merge' : undefined;
  return undefined;
}
