import { afterAll, expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { feedRows, Timeline, withSkaroNote } from '@skaro/timeline';
import { TaskExecution } from './task-execution';
import { taskBlockerTool } from '@skaro/mcp-server';

const db = AppDb.open(':memory:');
afterAll(() => db.close());

it('resolves only the subscribed incident and never undoes an explicit stop or a newer intent', () => {
  const execution = new TaskExecution(db, 'incident-intent');
  execution.start();
  const intent = execution.intentVersion();
  execution.block('Unavailable', 'incident');
  execution.clearBlock();
  expect(execution.read().blockedIncident).toBe('incident');
  expect(execution.clearIncident('other', intent)).toBe(false);
  execution.stop();
  expect(execution.clearIncident('incident', intent)).toBe(false);
  execution.decisionAnswered();
  expect(execution.read().enabled).toBe(false);
  execution.start();
  execution.block('Unavailable', 'incident');
  expect(execution.clearIncident('incident', intent)).toBe(false);
  expect(execution.clearIncident('incident', execution.intentVersion())).toBe(true);
  expect(execution.read().blocked).toBeUndefined();
});

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

it('rejects missing owner permission without blocking execution and records actual external failures', async () => {
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
  for (const permission of [true, undefined, 'false']) {
    const result = await tool.call(
      {
        reason: 'The shared environment needs an update and restart.',
        cause: 'environment',
        code: 'runtime_candidate_unavailable',
        requires_owner_permission: permission,
      },
      scope,
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ failure: { blockerRecorded: false } });
    expect(execution.read()).toEqual({ enabled: true, stalls: 0 });
  }
  await tool.call(
    { reason: 'External endpoint unavailable', requires_owner_permission: false },
    scope,
  );
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
