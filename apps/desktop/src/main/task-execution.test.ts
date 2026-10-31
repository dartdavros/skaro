import { afterAll, expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { feedRows, Timeline, withSkaroNote } from '@skaro/timeline';
import { TaskExecution } from './task-execution';
import { taskBlockerTool } from '@skaro/mcp-server';

const db = AppDb.open(':memory:');
afterAll(() => db.close());

it('retains execution intent and a concrete blocker across controller restoration', () => {
  const execution = new TaskExecution(db, 'restore');
  execution.start();
  execution.block('The documented external endpoint is unavailable.');
  expect(new TaskExecution(db, 'restore').read()).toMatchObject({
    enabled: true,
    blocked: 'The documented external endpoint is unavailable.',
  });
  execution.clearBlock();
  expect(execution.read().blocked).toBeUndefined();
  execution.stop();
  expect(new TaskExecution(db, 'restore').read().enabled).toBe(false);
});

it('deduplicates terminal events and bounds consecutive turns without progress', () => {
  const execution = new TaskExecution(db, 'stalls');
  execution.start();
  expect(execution.next('first', 'same-code')).toBe('continue');
  expect(new TaskExecution(db, 'stalls').next('first', 'same-code')).toBe('duplicate');
  expect(execution.next('second', 'same-code')).toBe('continue');
  expect(execution.next('third', 'same-code')).toBe('stalled');
  expect(execution.next('fourth', 'verified-change')).toBe('continue');
  expect(execution.read().stalls).toBe(0);
});

it('records an actual task blocker through the MCP contract without accepting or completing work', async () => {
  const execution = new TaskExecution(db, 'blocked-task');
  execution.start();
  const tool = taskBlockerTool(async (reason) => {
    execution.block(reason);
    return { text: 'Recorded' };
  });
  const scope = {
    kind: 'task' as const,
    projectId: 'project',
    taskId: 'T-1',
    runId: 'blocked-task',
  };
  expect((await tool.call({ reason: '' }, scope)).isError).toBe(true);
  expect(
    (
      await tool.call(
        { reason: 'External endpoint unavailable' },
        { kind: 'project_chat', projectId: 'project' },
      )
    ).isError,
  ).toBe(true);
  expect(execution.read().blocked).toBeUndefined();
  await tool.call({ reason: 'External endpoint unavailable' }, scope);
  expect(new TaskExecution(db, 'blocked-task').read()).toMatchObject({
    enabled: true,
    blocked: 'External endpoint unavailable',
  });
  execution.start();
  expect(execution.read()).toEqual({ enabled: true, stalls: 0 });
});

it('keeps internal continuation delivery evidence without inventing an owner message', () => {
  const timeline = Timeline.from([
    {
      t: 'item.upsert',
      item: {
        id: 'continuation',
        turnId: 'turn',
        kind: 'message',
        role: 'user',
        text: withSkaroNote(
          'command_id: continue-run-turn\norchestration: task',
          'Continue the authorized task.',
        ),
        status: 'done',
        startedAt: 1,
        native: { agent: 'codex', type: 'userMessage', ref: 'continuation' },
      },
    },
  ]);
  expect(timeline.state.items).toHaveLength(1);
  expect(feedRows(timeline.state)).toEqual([]);
});
