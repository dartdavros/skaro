import { withoutSkaroNote } from './feed-input.ts';
export { withSkaroNote, withoutSkaroNote } from './feed-input.ts';
import { fileRow, mergeFile, turnEnd } from './feed-turns.ts';
// Feed rows: how the timeline is shown (agent-output.md 5, "Лента агента" mockup). Pure and
// agent-agnostic: the same rows for Claude Code and Codex.

import type { FileChange, InteractionAnswer, Item } from './model.ts';
import type { TimelineState, TurnState } from './state.ts';
import { isAsyncQuestion, type AsyncQuestion } from './async-question.ts';
import { questionHistory } from './feed-questions.ts';
import { architecturePresentation } from './architecture-proposal.ts';

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

/**
 * One line of the "files changed" list at the end of a turn; counts absent when not reported.
 * The diffs of all its edits in the turn, in order, open in the diff window.
 */
export interface TurnFile {
  path: string;
  /** A file created in the turn stays "add" through later edits. */
  change: FileChange['change'];
  movePath?: string;
  added?: number;
  removed?: number;
  diffs: string[];
}

export type FeedRow =
  | { type: 'user'; id: string; item: Of<'message'>; images: Of<'image'>[]; hidden?: boolean }
  | { type: 'agent'; id: string; item: Of<'message'>; final: boolean }
  | { type: 'question'; id: string; item: Of<'message'>; interaction: AsyncQuestion }
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
  /** A chat agent's proposal: a card between the replies (agent-output.md 5.4). */
  | { type: 'proposal'; id: string; item: Of<'proposal'> }
  /** "Подготовлено 30 файлов · 12 пропущено": the copy of an import's sources. */
  | { type: 'import_prep'; id: string; item: Of<'import_prep'> }
  | {
      type: 'turn_end';
      id: string;
      turn: TurnState;
      durationMs: number;
      /** Distinct files changed in the turn, with lines summed over all their edits. */
      files: TurnFile[];
      tokens?: number;
    };

/** Skaro's own MCP tools are shown as cards, never as tool rows (agent-output.md 5.4). */
function hidden(item: Item): boolean {
  return (
    (item.kind === 'tool' && item.server === 'skaro') ||
    (item.kind === 'proposal' && item.state === 'superseded')
  );
}

/**
 * Skaro puts the user's decisions on proposals in front of the next message for the agent
 * (agent-output.md 5.4); the feed shows the message as the user wrote it.
 */
function isUserImage(item: Item): item is Of<'image'> {
  return item.kind === 'image' && item.native.type.startsWith('user');
}

/** Rows of the main feed (or of one subagent when `parentId` is given). */
export function feedRows(state: TimelineState, parentId?: string): FeedRow[] {
  const { items: history, cardAnswers } = questionHistory(state.items);
  const byParent = new Map<string | undefined, Item[]>();
  const byTurn = new Map<string, Item[]>();
  const questions = new Map(state.interactions.filter(isAsyncQuestion).map((i) => [i.itemId, i]));
  const itemTurns = new Map(state.items.map((item) => [item.id, item.turnId]));
  const waitingTurns = new Set(
    state.interactions
      .filter((i) => i.kind === 'question')
      .map(
        (i) =>
          ('itemId' in i && i.itemId ? itemTurns.get(i.itemId) : undefined) ??
          state.turns.at(-1)?.id,
      ),
  );
  for (const item of history) {
    if (hidden(item)) continue;
    const siblings = byParent.get(item.parentId) ?? [];
    siblings.push(item);
    byParent.set(item.parentId, siblings);
    if (!item.parentId) {
      const turn = byTurn.get(item.turnId) ?? [];
      turn.push(item);
      byTurn.set(item.turnId, turn);
    }
  }
  return rowsFor(parentId);
  function rowsFor(parentId?: string): FeedRow[] {
    const items = byParent.get(parentId) ?? [];
    const rows: FeedRow[] = [];
    const turnEnds = new Map<string, TurnState>();
    for (const turn of state.turns)
      if (turn.outcome && !waitingTurns.has(turn.id)) turnEnds.set(turn.id, turn);
    const lastItemOfTurn = new Map<string, number>();
    items.forEach((item, index) => lastItemOfTurn.set(item.turnId, index));

    items.forEach((item, index) => {
      const prev = rows.at(-1);
      switch (item.kind) {
        case 'message':
          if (item.role === 'user') {
            const text = cardAnswers.get(item.id) ?? withoutSkaroNote(item.text);
            rows.push({
              type: 'user',
              id: item.id,
              item: text === item.text ? item : { ...item, text },
              images: [],
              ...(cardAnswers.has(item.id) ? { hidden: true } : {}),
            });
          } else {
            const question = questions.get(item.id);
            if (isAsyncQuestion(question))
              rows.push({ type: 'question', id: item.id, item, interaction: question });
            else rows.push({ type: 'agent', id: item.id, item, final: item.phase === 'final' });
          }
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
            const children = rowsFor(item.id);
            rows.push({
              type: 'task',
              id: item.id,
              item,
              children,
              actions: item.actions ?? byParent.get(item.id)?.length ?? 0,
            });
          }
          break;
        case 'reasoning':
          // Only the live "Думает…" line; a finished "Думал 12 с" carries nothing (owner's call).
          if (item.status === 'running') rows.push({ type: 'reasoning', id: item.id, item });
          break;
        case 'command':
          rows.push({ type: 'command', id: item.id, item });
          break;
        case 'tool':
          rows.push({ type: 'tool', id: item.id, item });
          break;
        case 'notice':
          // «Контекст сжат» says it happened: a compaction still running or failed is no divider.
          if (item.code !== 'compaction' || item.status === 'done')
            rows.push({ type: 'notice', id: item.id, item });
          break;
        case 'unknown':
          rows.push({ type: 'unknown', id: item.id, item });
          break;
        case 'proposal':
          rows.push({
            type: 'proposal',
            id: item.id,
            item:
              item.proposal.type === 'architecture'
                ? {
                    ...item,
                    proposal: architecturePresentation(
                      item.proposal,
                      item.proposal.contentRef ?? item.id,
                    ),
                  }
                : item,
          });
          break;
        case 'import_prep':
          rows.push({ type: 'import_prep', id: item.id, item });
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
        rows.push(turnEnd(turn, byTurn.get(turn.id) ?? []));
      }
    });
    return rows;
  }
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

export { exploreCounts } from './feed-explore.ts';
