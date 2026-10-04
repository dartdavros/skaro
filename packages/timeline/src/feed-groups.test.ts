import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { feedRows, type FeedRow } from './feed.ts';
import { actionGroupState, groupFeedRows, type ActionGroup } from './feed-groups.ts';
import {
  actionGroupDiffStats,
  actionGroupSummary,
  dominantAction,
  reconnectionProgress,
} from './feed-action-summary.ts';
import { GOLDEN_DIR } from './golden.ts';
import type { TimelineState } from './state.ts';

const captured = (agent: string, scenario: string): FeedRow[] =>
  feedRows(
    JSON.parse(
      readFileSync(join(GOLDEN_DIR, agent, scenario, 'timeline.json'), 'utf8'),
    ) as TimelineState,
  );
function sameTurn<R extends FeedRow>(row: R): R {
  if ('items' in row) return { ...row, items: row.items.map((i) => ({ ...i, turnId: 't' })) } as R;
  if ('item' in row) return { ...row, item: { ...row.item, turnId: 't' } } as R;
  return row;
}
const command = sameTurn(captured('codex', 'failing-command').find((r) => r.type === 'command')!);
const file = sameTurn(captured('codex', 'edit').find((r) => r.type === 'file')!);
const user = captured('codex', 'edit').find((r) => r.type === 'user')!;
const explore = sameTurn(captured('claude', 'read').find((r) => r.type === 'explore')!);
const copy = <R extends FeedRow>(row: R, id: string): R => ({ ...row, id });

describe('consecutive action groups', () => {
  it('groups all adjacent action types including reads without crossing a user message', () => {
    const blocks = groupFeedRows([
      command,
      copy(command, 'c2'),
      file,
      copy(file, 'f2'),
      explore,
      copy(command, 'c3'),
      user,
      copy(command, 'c4'),
    ]);
    expect(
      blocks.map((b) => (b.type === 'actions' ? b.rows.map((r) => r.type) : b.row.type)),
    ).toEqual([['command', 'command', 'file', 'file', 'explore', 'command'], 'user', ['command']]);
  });

  it('keeps the exact command output and file diffs, without mutating source rows', () => {
    const input = Object.freeze([command, copy(command, 'c2'), file]);
    const blocks = groupFeedRows(input) as ActionGroup[];
    expect(blocks[0]!.rows[0]).toBe(command);
    expect(blocks[0]!.rows[2]).toBe(file);
    expect(input).toHaveLength(3);
    expect(actionGroupState(blocks[0]!, new Set()).failed).toBe(true);
  });

  it('keeps the first action as a stable key while a sequence grows during streaming', () => {
    const before = groupFeedRows([command])[0]!;
    const after = groupFeedRows([command, copy(command, 'c2')])[0]!;
    expect(after.id).toBe(before.id);
  });

  it('counts underlying edits while preserving their expanded history', () => {
    const group = groupFeedRows([file, copy(file, 'f2')])[0] as ActionGroup;
    expect(actionGroupSummary(group).find((p) => p.kind === 'file')?.count).toBe(
      file.items[0]!.files.length,
    );
    expect(group.rows).toHaveLength(2);
  });

  it('sums line counts of applied edits for the collapsed group badge', () => {
    if (file.type !== 'file') throw new Error('Expected captured file');
    const other = { ...file, id: 'f2', added: 3, removed: 1 };
    const declined = { ...file, id: 'f3', added: 50, removed: 50, status: 'declined' as const };
    const group = groupFeedRows([file, command, other, declined])[0] as ActionGroup;
    expect(actionGroupDiffStats(group)).toEqual({
      added: (file.added ?? 0) + 3,
      removed: (file.removed ?? 0) + 1,
    });
    expect(actionGroupDiffStats(groupFeedRows([command])[0] as ActionGroup)).toBeUndefined();
  });

  it('exposes pending permissions and input even in a collapsed command sequence', () => {
    if (command.type !== 'command') throw new Error('Expected captured command');
    const live = {
      ...command,
      item: {
        ...command.item,
        exitCode: undefined,
        status: 'running' as const,
        awaitingInput: true,
      },
    };
    const group = groupFeedRows([live])[0] as ActionGroup;
    expect(actionGroupState(group, new Set([live.item.id]))).toMatchObject({
      waiting: true,
      running: true,
      awaitingInput: true,
      failed: false,
    });
  });

  it('retains screenshots inside tool groups and breaks sequences at turn boundaries', () => {
    const imageTool: FeedRow = {
      type: 'tool',
      id: 'screen',
      item: {
        kind: 'tool',
        id: 'screen',
        turnId: 't',
        startedAt: 0,
        status: 'done',
        native: { agent: 'codex', type: 'mcpToolCall', ref: '' },
        name: 'screenshot',
        images: [{ id: 'captured-image', mime: 'image/png' }],
      },
    };
    const end = captured('codex', 'failing-command').find((r) => r.type === 'turn_end')!;
    const blocks = groupFeedRows([
      command,
      imageTool,
      copy(imageTool, 'screen2'),
      copy(command, 'c2'),
      end,
      copy(command, 'c3'),
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['actions', 'row', 'actions']);
    expect((blocks[0] as ActionGroup).rows.slice(1, 3)).toEqual([
      imageTool,
      copy(imageTool, 'screen2'),
    ]);
  });

  it('separates subagent turns even when their feed has no turn-end row', () => {
    if (command.type !== 'command') throw new Error('Expected captured command');
    const nextTurn = {
      ...copy(command, 'next-turn'),
      item: { ...command.item, turnId: `${command.item.turnId}-next` },
    };
    const blocks = groupFeedRows([command, nextTurn]);
    expect(blocks).toHaveLength(2);
  });

  it('chooses the majority action from native items, including web searches, with stable ties', () => {
    const group = groupFeedRows([command, explore])[0] as ActionGroup;
    expect(dominantAction(actionGroupSummary(group))).toBe('read');
    expect(
      dominantAction([
        { kind: 'file', count: 2, running: false, pending: false, performed: true },
        { kind: 'command', count: 2, running: false, pending: false, performed: true },
      ]),
    ).toBe('file');
    expect(
      dominantAction([
        { kind: 'command', count: 2, running: false, pending: false, performed: true },
        { kind: 'search', count: 1, running: false, pending: false, performed: true },
        { kind: 'web', count: 2, running: false, pending: false, performed: true },
      ]),
    ).toBe('search');
  });

  it('groups real reconnection notices but keeps final errors outside the fold', () => {
    const notices = captured('codex', 'auth-error').filter((r) => r.type === 'notice');
    const retry = sameTurn(notices.find((r) => r.item.code === 'retry')!);
    const error = sameTurn(notices.find((r) => r.item.level === 'error')!);
    const blocks = groupFeedRows([command, retry, error]);
    expect(blocks.map((b) => b.type)).toEqual(['actions', 'row']);
    const summary = actionGroupSummary(blocks[0] as ActionGroup);
    expect(summary.find((p) => p.kind === 'reconnect')?.progress).toEqual({ attempt: 5, max: 5 });
    expect(reconnectionProgress(retry.item)).toEqual({ attempt: 5, max: 5 });
  });
});
