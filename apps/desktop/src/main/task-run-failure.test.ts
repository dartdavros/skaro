import type { TaskRuntime } from '@skaro/core';
import { Timeline } from '@skaro/timeline';
import { expect, it, vi } from 'vitest';
import { ActiveRun } from './tasks';
import { TaskRunEvents } from './task-run-events';

it('keeps a task on its stage after a failed turn and holds the error until the agent works', async () => {
  const runtime = new Map<string, { state: TaskRuntime }>();
  const updateTask = vi.fn();
  const runs = Object.create(TaskRunEvents.prototype) as TaskRunEvents;
  Object.assign(runs, {
    ctx: {
      deps: { db: { getTaskRuntime: () => runtime, addEvent: vi.fn() } },
      setRuntime: (_p: string, taskId: string, state: TaskRuntime) =>
        state === 'idle' ? runtime.delete(taskId) : runtime.set(taskId, { state }),
      project: () => ({
        store: {
          readTask: async () => ({ id: 'T-1', title: 'Task', status: 'review' }),
          updateTask,
        },
      }),
      results: { statusChanged: vi.fn() },
      limitEnvironments: vi.fn(),
      changed: vi.fn(),
    },
  });
  const active = new ActiveRun('project', 'T-1', { id: 'run' } as ActiveRun['run'], new Timeline());

  await runs.onTurnCompleted(active, 'failed');
  expect(updateTask).not.toHaveBeenCalled();
  expect(runtime.get('T-1')?.state).toBe('failed');

  // A late event of the failed turn does not clear the error; the next turn does.
  runs.settleRuntime(active);
  expect(runtime.get('T-1')?.state).toBe('failed');
  runs.onEvent(active, { t: 'turn.started', turnId: 'next' });
  clearTimeout(active.flushTimer);
  expect(runtime.get('T-1')?.state).toBe('running');
});
