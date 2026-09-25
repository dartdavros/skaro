// Feed rows: how the timeline is shown (agent-output.md 5, "Лента агента" mockup). Pure and
// agent-agnostic: the same rows for Claude Code and Codex.

import type { FileChange, InteractionAnswer, Item } from './model.ts';
import type { TimelineState, TurnState } from './state.ts';

type Of<K extends Item['kind']> = Extract<Item, { kind: K }>;

/** One file line: consecutive edits of the same file collapse into one (agent-output.md 5.1). */
export interface FileRow {
  type: 'file';
  id: string;
  path: string;
  change: FileChange['change'];
  movePath?: string;
  added?: number;
  removed?: number;
  diffs: string[];
  status: Item['status'];
  items: Of<'file_change'>[];
}

export type FeedRow =
  | { type: 'user'; id: string; item: Of<'message'>; images: Of<'image'>[] }
  | { type: 'agent'; id: string; item: Of<'message'>; final: boolean }
  | { type: 'reasoning'; id: string; item: Of<'reasoning'> }
  | { type: 'explore'; id: string; items: Of<'explore'>[] }
  | FileRow
  | { type: 'command'; id: string; item: Of<'command'> }
  | { type: 'task'; id: string; item: Of<'task'>; children: FeedRow[]; actions: number }
  | { type: 'tool'; id: string; item: Of<'tool'> }
  | { type: 'image'; id: string; item: Of<'image'> }
  | { type: 'notice'; id: string; item: Of<'notice'> }
  | { type: 'unknown'; id: string; item: Of<'unknown'> }
  /** A decision without a row of its own (questions, plans, forms): a summary line. */
  | { type: 'decision'; id: string; item: Of<'decision'> }
  | {
      type: 'turn_end';
      id: string;
      turn: TurnState;
      durationMs: number;
      /** Distinct files changed in the turn. */
      files: number;
      tokens?: number;
    };

/** Skaro's own MCP tools are shown as cards, never as tool rows (agent-output.md 5.4). */
function hidden(item: Item): boolean {
  return item.kind === 'tool' && item.server === 'skaro';
}

function isUserImage(item: Item): item is Of<'image'> {
  return item.kind === 'image' && item.native.type.startsWith('user');
}

/** Rows of the main feed (or of one subagent when `parentId` is given). */
export function feedRows(state: TimelineState, parentId?: string): FeedRow[] {
  const items = state.items.filter((i) => i.parentId === parentId && !hidden(i));
  const rows: FeedRow[] = [];
  const turnEnds = new Map<string, TurnState>();
  for (const turn of state.turns) if (turn.outcome) turnEnds.set(turn.id, turn);
  const lastItemOfTurn = new Map<string, number>();
  items.forEach((item, index) => lastItemOfTurn.set(item.turnId, index));

  items.forEach((item, index) => {
    const prev = rows.at(-1);
    switch (item.kind) {
      case 'message':
        if (item.role === 'user') rows.push({ type: 'user', id: item.id, item, images: [] });
        else rows.push({ type: 'agent', id: item.id, item, final: item.phase === 'final' });
        break;
      case 'image':
        if (isUserImage(item) && prev?.type === 'user') prev.images.push(item);
        else rows.push({ type: 'image', id: item.id, item });
        break;
      case 'explore':
        if (prev?.type === 'explore') prev.items.push(item);
        else rows.push({ type: 'explore', id: item.id, items: [item] });
        break;
      case 'file_change':
        for (const file of item.files) {
          const last = rows.at(-1);
          if (last?.type === 'file' && last.path === file.path && file.change === 'update') {
            mergeFile(last, file, item);
          } else {
            rows.push(fileRow(file, item));
          }
        }
        break;
      case 'task':
        {
          const children = feedRows(state, item.id);
          rows.push({
            type: 'task',
            id: item.id,
            item,
            children,
            actions: item.actions ?? state.items.filter((i) => i.parentId === item.id).length,
          });
        }
        break;
      case 'reasoning':
        rows.push({ type: 'reasoning', id: item.id, item });
        break;
      case 'command':
        rows.push({ type: 'command', id: item.id, item });
        break;
      case 'tool':
        rows.push({ type: 'tool', id: item.id, item });
        break;
      case 'notice':
        rows.push({ type: 'notice', id: item.id, item });
        break;
      case 'unknown':
        rows.push({ type: 'unknown', id: item.id, item });
        break;
      case 'decision':
        // Permissions show on the row they were about; the rest get a summary line.
        if (!(item.interaction.kind === 'approval' && item.interaction.itemId)) {
          rows.push({ type: 'decision', id: item.id, item });
        }
        break;
    }
    const turn = turnEnds.get(item.turnId);
    if (parentId === undefined && turn && lastItemOfTurn.get(item.turnId) === index) {
      rows.push(
        turnEnd(
          turn,
          items.filter((i) => i.turnId === turn.id),
        ),
      );
    }
  });
  return rows;
}

function fileRow(file: FileChange, item: Of<'file_change'>): FileRow {
  return {
    type: 'file',
    id: `${item.id}:${file.path}`,
    path: file.path,
    change: file.change,
    ...(file.movePath ? { movePath: file.movePath } : {}),
    ...(file.added !== undefined ? { added: file.added } : {}),
    ...(file.removed !== undefined ? { removed: file.removed } : {}),
    diffs: file.diff ? [file.diff] : [],
    status: item.status,
    items: [item],
  };
}

function mergeFile(row: FileRow, file: FileChange, item: Of<'file_change'>): void {
  if (file.added !== undefined) row.added = (row.added ?? 0) + file.added;
  if (file.removed !== undefined) row.removed = (row.removed ?? 0) + file.removed;
  if (file.diff) row.diffs.push(file.diff);
  row.items.push(item);
  // The row shows the latest state: a pending or failed edit wins over earlier done ones.
  row.status = item.status;
}

function turnEnd(turn: TurnState, items: Item[]): FeedRow {
  let start = Infinity;
  let end = 0;
  const files = new Set<string>();
  for (const item of items) {
    start = Math.min(start, item.startedAt);
    end = Math.max(end, item.endedAt ?? item.startedAt);
    if (item.kind === 'file_change' && item.status === 'done') {
      for (const f of item.files) files.add(f.path);
    }
  }
  return {
    type: 'turn_end',
    id: `end:${turn.id}`,
    turn,
    durationMs: Number.isFinite(start) ? Math.max(0, end - start) : 0,
    files: files.size,
    ...(turn.usage ? { tokens: turn.usage.inputTokens + turn.usage.outputTokens } : {}),
  };
}

/** Permission decisions by the item they were about: "разрешено" / "запрещено" (mockup 4f). */
export function approvalDecisions(state: TimelineState): Map<string, InteractionAnswer> {
  const decisions = new Map<string, InteractionAnswer>();
  for (const item of state.items) {
    if (
      item.kind === 'decision' &&
      item.interaction.kind === 'approval' &&
      item.interaction.itemId
    ) {
      decisions.set(item.interaction.itemId, item.answer);
    }
  }
  return decisions;
}

/** Background commands still shown above the composer (agent-output.md 5.1). */
export function backgroundCommands(state: TimelineState): Of<'command'>[] {
  return state.items.filter(
    (i): i is Of<'command'> => i.kind === 'command' && i.background !== undefined,
  );
}

/** Explore summary counts: files read, searches, pages, listings, images viewed. */
export function exploreCounts(items: Of<'explore'>[]): {
  read: number;
  images: number;
  search: string[];
  list: number;
  pages: number;
  web: string[];
} {
  const counts = {
    read: 0,
    images: 0,
    search: [] as string[],
    list: 0,
    pages: 0,
    web: [] as string[],
  };
  const seen = new Set<string>();
  for (const item of items) {
    if (item.op === 'read') {
      if (item.image) counts.images++;
      else if (!seen.has(item.target)) {
        seen.add(item.target);
        counts.read++;
      }
    } else if (item.op === 'search') counts.search.push(item.target);
    else if (item.op === 'list') counts.list++;
    else if (item.op === 'fetch') counts.pages++;
    else counts.web.push(item.target);
  }
  return counts;
}
