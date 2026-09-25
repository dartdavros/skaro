import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { approvalDecisions, exploreCounts, feedRows, type FeedRow } from './feed.ts';
import { GOLDEN_DIR } from './golden.ts';
import type { Item } from './model.ts';
import type { TimelineState } from './state.ts';

const golden = (agent: string, scenario: string): TimelineState =>
  JSON.parse(readFileSync(join(GOLDEN_DIR, agent, scenario, 'timeline.json'), 'utf8'));

const types = (rows: FeedRow[]) => rows.map((r) => r.type);

describe('feedRows', () => {
  it('groups reads and searches into one line and ends the turn with a summary', () => {
    const rows = feedRows(golden('claude', 'read'));
    expect(types(rows)).toEqual(['user', 'notice', 'explore', 'reasoning', 'agent', 'turn_end']);
    const explore = rows[2] as Extract<FeedRow, { type: 'explore' }>;
    expect(exploreCounts(explore.items)).toMatchObject({ read: 2, search: [expect.any(String)] });
    const end = rows.at(-1) as Extract<FeedRow, { type: 'turn_end' }>;
    expect(end.tokens).toBe(63125 + 504);
  });

  it('shows one line per file for both agents and counts changed files in the turn', () => {
    for (const agent of ['claude', 'codex']) {
      const rows = feedRows(golden(agent, 'edit'));
      const files = rows.filter((r) => r.type === 'file');
      expect(files.map((f) => f.path.split(/[\\/]/).pop()).sort(), agent).toEqual([
        'CHANGELOG.md',
        'math.js',
      ]);
      expect(rows.at(-1)).toMatchObject({ type: 'turn_end', files: 2 });
    }
  });

  it('collapses consecutive edits of the same file with summed counts', () => {
    const edit = (id: string, added: number, removed: number): Item => ({
      id,
      turnId: 't1',
      kind: 'file_change',
      files: [{ path: 'src/a.ts', change: 'update', added, removed, diff: `@@ ${id}` }],
      status: 'done',
      startedAt: 0,
      native: { agent: 'test', type: 'edit', ref: id },
    });
    const state: TimelineState = {
      turns: [],
      items: [edit('e1', 3, 1), edit('e2', 2, 0)],
      interactions: [],
      status: 'working',
    };
    expect(feedRows(state)).toEqual([
      expect.objectContaining({
        type: 'file',
        path: 'src/a.ts',
        added: 5,
        removed: 1,
        diffs: ['@@ e1', '@@ e2'],
      }),
    ]);
  });

  it('nests subagent items under their task row', () => {
    for (const agent of ['claude', 'codex']) {
      const rows = feedRows(golden(agent, 'subagent'));
      const task = rows.find((r) => r.type === 'task');
      expect(task, agent).toBeDefined();
      if (task?.type !== 'task') continue;
      expect(task.children.length, agent).toBeGreaterThan(0);
      expect(task.actions, agent).toBe(task.children.length);
      expect(
        rows.some((r) => r.type === 'command'),
        agent,
      ).toBe(false);
    }
  });

  it('attaches the images a user sent to the user bubble', () => {
    const rows = feedRows(golden('claude', 'image'));
    const second = rows.filter((r) => r.type === 'user')[1];
    expect(second?.type === 'user' && second.images.length).toBe(1);
    expect(rows.some((r) => r.type === 'image')).toBe(false);
  });

  it('hides calls of Skaro tools: they are cards', () => {
    const state: TimelineState = {
      turns: [],
      items: [
        {
          id: 'x',
          turnId: 't1',
          kind: 'tool',
          name: 'merge_task',
          server: 'skaro',
          status: 'done',
          startedAt: 0,
          native: { agent: 'test', type: 'mcp', ref: 'x' },
        },
      ],
      interactions: [],
      status: 'idle',
    };
    expect(feedRows(state)).toEqual([]);
  });

  it('keeps decisions: permissions on their row, other answers as a line', () => {
    const base = { turnId: 't1', status: 'done' as const, startedAt: 0 };
    const state: TimelineState = {
      turns: [],
      items: [
        {
          ...base,
          id: 'cmd',
          kind: 'command',
          command: 'npm install',
          output: '',
          outputLive: false,
          native: { agent: 'test', type: 'bash', ref: 'cmd' },
        },
        {
          ...base,
          id: 'd1',
          kind: 'decision',
          interaction: {
            kind: 'approval',
            id: 'a1',
            itemId: 'cmd',
            action: { type: 'command', title: 'npm install' },
            choices: ['allow_once', 'deny'],
          },
          answer: { kind: 'approval', choice: 'deny' },
          native: { agent: 'skaro', type: 'decision', ref: 'a1' },
        },
        {
          ...base,
          id: 'd2',
          kind: 'decision',
          interaction: { kind: 'plan_approval', id: 'p1', plan: '1. Do it' },
          answer: { kind: 'plan_approval', approve: true },
          native: { agent: 'skaro', type: 'decision', ref: 'p1' },
        },
      ],
      interactions: [],
      status: 'idle',
    };
    expect(types(feedRows(state))).toEqual(['command', 'decision']);
    expect(approvalDecisions(state).get('cmd')).toEqual({ kind: 'approval', choice: 'deny' });
  });
});
