import { expect, it, vi } from 'vitest';
import { Timeline } from '@skaro/timeline';
import { ActiveRun } from './tasks';
import { TaskRunEvents } from './task-run-events';

it('keeps the task queue slot during a permission restart and settles a real stop normally', () => {
  const onTurnCompleted = vi.fn();
  const runs = Object.create(TaskRunEvents.prototype) as TaskRunEvents;
  Object.assign(runs, { onTurnCompleted, ctx: { history: { flush: () => undefined } } });
  const active = new ActiveRun('project', 'task', {} as ActiveRun['run'], new Timeline());
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
    expect(onTurnCompleted).toHaveBeenCalledWith(active, 'done');
  } finally {
    clearTimeout(active.flushTimer);
  }
});
