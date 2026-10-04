import type { FeedRow } from './feed.ts';
import type { Item } from './model.ts';

export type ActionRow = Extract<
  FeedRow,
  { type: 'command' | 'file' | 'tool' | 'task' | 'explore' | 'image' | 'notice' }
>;
export interface ActionGroup {
  type: 'actions';
  id: string;
  rows: ActionRow[];
}
export type FeedBlock = ActionGroup | { type: 'row'; id: string; row: FeedRow };

function groupable(row: FeedRow): row is ActionRow {
  if (row.type === 'notice')
    return row.item.code === 'retry' || row.item.code === 'session_restored';
  return ['command', 'file', 'tool', 'task', 'explore', 'image'].includes(row.type);
}

export const actionItems = (row: ActionRow): Item[] =>
  row.type === 'file' || row.type === 'explore' ? row.items : [row.item];
const turnId = (row: ActionRow) => actionItems(row)[0]?.turnId;

/** Group adjacent actions of any kind, retaining their original order and turn boundaries. */
export function groupFeedRows(rows: readonly FeedRow[]): FeedBlock[] {
  const blocks: FeedBlock[] = [];
  for (const row of rows) {
    const last = blocks.at(-1);
    if (groupable(row)) {
      if (last?.type === 'actions' && turnId(last.rows[0]!) === turnId(row)) last.rows.push(row);
      else blocks.push({ type: 'actions', id: `actions:${row.id}`, rows: [row] });
    } else blocks.push({ type: 'row', id: row.id, row });
  }
  return blocks;
}

export function actionGroupState(group: ActionGroup, waiting: ReadonlySet<string>) {
  const items = group.rows.flatMap(actionItems);
  return {
    waiting: items.some((item) => waiting.has(item.id) || item.status === 'queued'),
    running: items.some((item) => item.status === 'running'),
    failed: items.some(
      (item) =>
        item.status === 'failed' ||
        (item.kind === 'command' && item.exitCode !== undefined && item.exitCode !== 0),
    ),
    declined: items.some((item) => item.status === 'declined'),
    interrupted: items.some((item) => item.status === 'interrupted'),
    awaitingInput: items.some((item) => item.kind === 'command' && item.awaitingInput),
  };
}
