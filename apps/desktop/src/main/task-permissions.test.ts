import { expect, it, vi } from 'vitest';
import { Timeline } from '@skaro/timeline';
import { ActiveRun } from './tasks';
import { TaskRunEvents } from './task-run-events';

it('keeps the task queue slot during a permission restart and settles a real stop normally', async () => {
  const onTurnCompleted = vi.fn().mockResolvedValue(undefined);
  const runs = Object.create(TaskRunEvents.prototype) as TaskRunEvents;
  const active = new ActiveRun('project', 'task', {} as ActiveRun['run'], new Timeline());
  Object.assign(runs, {
    onTurnCompleted,
    ctx: {
      active: new Map([['project\ntask', active]]),
      changed: () => undefined,
      history: { flush: () => undefined },
    },
  });
  const receive = runs.onEvent.bind(runs);
  try {
    receive(active, {
      t: 'turn.completed',
      turnId: 'old',
      outcome: 'interrupted',
      continuing: true,
    });
    expect(onTurnCompleted).not.toHaveBeenCalled();
    receive(active, { t: 'turn.completed', turnId: 'next', outcome: 'done' });
    await vi.waitFor(() => expect(onTurnCompleted).toHaveBeenCalledWith(active, 'done'));
  } finally {
    clearTimeout(active.flushTimer);
  }
});
