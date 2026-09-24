import { describe, expect, it } from 'vitest';
import type { Task } from '../artifacts/model.ts';
import { indexTasks, startBlocker } from '../status.ts';
import { RunQueue, type QueueEvent } from './run-queue.ts';

/** Runs that finish when the test says so. */
function controlledRuns() {
  const pending = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  return {
    start: (id: string) =>
      new Promise<void>((resolve, reject) => pending.set(id, { resolve, reject })),
    finish: async (id: string, error?: Error) => {
      const run = pending.get(id)!;
      pending.delete(id);
      if (error) run.reject(error);
      else run.resolve();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe('RunQueue', () => {
  it('runs up to the slot count and starts queued tasks in order as slots free up', async () => {
    const runs = controlledRuns();
    const queue = new RunQueue({ slots: 2, canRun: () => undefined, start: runs.start });
    const events: QueueEvent[] = [];
    queue.on((e) => events.push(e));

    expect(queue.enqueue(['A', 'B', 'C', 'D']).accepted).toEqual(['A', 'B', 'C', 'D']);
    expect(queue.state()).toEqual({ slots: 2, running: ['A', 'B'], queued: ['C', 'D'] });

    await runs.finish('B');
    expect(queue.state().running).toEqual(['A', 'C']);
    await runs.finish('A', new Error('agent crashed'));
    expect(queue.state()).toEqual({ slots: 2, running: ['C', 'D'], queued: [] });
    expect(events.filter((e) => e.type === 'finished')).toEqual([
      { type: 'finished', taskId: 'B' },
      { type: 'finished', taskId: 'A', error: new Error('agent crashed') },
    ]);

    const idle = queue.idle();
    await runs.finish('C');
    await runs.finish('D');
    await expect(idle).resolves.toBeUndefined();
  });

  it('defaults to three slots', () => {
    const runs = controlledRuns();
    const queue = new RunQueue({ canRun: () => undefined, start: runs.start });
    queue.enqueue(['A', 'B', 'C', 'D']);
    expect(queue.state().running).toHaveLength(3);
  });

  it('rejects blocked and duplicate tasks', () => {
    const tasks: Task[] = [
      {
        id: 'T-1',
        title: '',
        status: 'in_progress',
        dependsOn: [],
        unblocked: false,
        archived: false,
        body: '',
        path: '',
      },
      {
        id: 'T-2',
        title: '',
        status: 'todo',
        dependsOn: ['T-1'],
        unblocked: false,
        archived: false,
        body: '',
        path: '',
      },
      {
        id: 'T-3',
        title: '',
        status: 'todo',
        dependsOn: [],
        unblocked: false,
        archived: false,
        body: '',
        path: '',
      },
    ];
    const index = indexTasks(tasks);
    const runs = controlledRuns();
    const queue = new RunQueue({
      slots: 1,
      canRun: (id) => startBlocker(index.get(id)!, index),
      start: runs.start,
    });
    const result = queue.enqueue(['T-2', 'T-3', 'T-3']);
    expect(result).toEqual({
      accepted: ['T-3'],
      rejected: { 'T-2': 'blocked', 'T-3': 'already_queued' },
    });
  });

  it('drops a queued task that became unrunnable before its turn', async () => {
    const blocked = new Set<string>();
    const runs = controlledRuns();
    const queue = new RunQueue({
      slots: 1,
      canRun: (id) => (blocked.has(id) ? 'archived' : undefined),
      start: runs.start,
    });
    const events: QueueEvent[] = [];
    queue.on((e) => events.push(e));
    queue.enqueue(['A', 'B', 'C']);
    blocked.add('B');
    await runs.finish('A');
    expect(queue.state().running).toEqual(['C']);
    expect(events).toContainEqual({ type: 'dropped', taskId: 'B', reason: 'archived' });
  });

  it('cancels queued tasks and grows slots on the fly', () => {
    const runs = controlledRuns();
    const queue = new RunQueue({ slots: 1, canRun: () => undefined, start: runs.start });
    queue.enqueue(['A', 'B', 'C', 'D']);
    expect(queue.cancel('C')).toBe(true);
    expect(queue.cancel('A')).toBe(false); // running, not queued
    queue.setSlots(3);
    expect(queue.state()).toEqual({ slots: 3, running: ['A', 'B', 'D'], queued: [] });
  });

  it('frees the slot when start throws synchronously', async () => {
    const queue = new RunQueue({
      slots: 1,
      canRun: () => undefined,
      start: (id) => {
        if (id === 'A') throw new Error('no worktree');
        return Promise.resolve();
      },
    });
    queue.enqueue(['A', 'B']);
    await queue.idle();
    expect(queue.state()).toEqual({ slots: 1, running: [], queued: [] });
  });
});
