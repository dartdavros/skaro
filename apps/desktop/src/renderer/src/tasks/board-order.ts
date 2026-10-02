// The order of cards inside the board's columns, chosen by dragging. Kept per project in the app
// settings: it is the user's view of the board, not a property of the tasks.

import type { TaskSummary } from '../../../shared/ipc';
import type { ColumnKey } from './board-moves';

export type BoardOrder = Partial<Record<ColumnKey, string[]>>;

export const boardOrderKey = (projectId: string): string => `tasks.${projectId}.boardOrder`;

/** Cards with a saved place first, in that order; the rest (new ones) after, in list order. */
export function arrange(tasks: TaskSummary[], order: string[] | undefined): TaskSummary[] {
  if (!order?.length) return tasks;
  const place = new Map(order.map((id, i) => [id, i]));
  const placed = tasks.filter((t) => place.has(t.id));
  placed.sort((a, b) => place.get(a.id)! - place.get(b.id)!);
  return [...placed, ...tasks.filter((t) => !place.has(t.id))];
}

/** The ids of a column with `id` put at `index` (moved within it or dropped from another one). */
export function placed(ids: string[], id: string, index: number): string[] {
  const rest = ids.filter((x) => x !== id);
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, id);
  return rest;
}
