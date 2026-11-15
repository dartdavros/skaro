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
  it('starts every independent owner immediately without a capacity limit', async () => {
    const runs = controlledRuns();
    const queue = new RunQueue({ canRun: () => undefined, start: runs.start });
    const events: QueueEvent[] = [];
    queue.on((e) => events.push(e));

    expect(queue.enqueue(['A', 'B', 'C', 'D']).accepted).toEqual(['A', 'B', 'C', 'D']);
    expect(queue.state()).toEqual({ running: ['A', 'B', 'C', 'D'], queued: [] });

    await runs.finish('B');
    expect(queue.state().running).toEqual(['A', 'C', 'D']);
    await runs.finish('A', new Error('agent crashed'));
    expect(queue.state()).toEqual({ running: ['C', 'D'], queued: [] });
    expect(events.filter((e) => e.type === 'finished')).toEqual([
      { type: 'finished', taskId: 'B' },
      { type: 'finished', taskId: 'A', error: new Error('agent crashed') },
    ]);

    const idle = queue.idle();
    await runs.finish('C');
    await runs.finish('D');
    await expect(idle).resolves.toBeUndefined();
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
    const held = new Set(['B']);
    const runs = controlledRuns();
    const queue = new RunQueue({
      canRun: (id) => (blocked.has(id) ? 'archived' : undefined),
      blocked: (id) => held.has(id),
      start: runs.start,
    });
    const events: QueueEvent[] = [];
    queue.on((e) => events.push(e));
    queue.enqueue(['A', 'B', 'C']);
    blocked.add('B');
    held.clear();
    await runs.finish('A');
    expect(queue.state().running).toEqual(['C']);
    expect(events).toContainEqual({ type: 'dropped', taskId: 'B', reason: 'archived' });
  });

  it('cancels only held-back owners and starts the rest after their condition clears', () => {
    const runs = controlledRuns();
    const held = new Set(['C', 'D']);
    const queue = new RunQueue({
      canRun: () => undefined,
      blocked: (id) => held.has(id),
      start: runs.start,
    });
    queue.enqueue(['A', 'B', 'C', 'D']);
    expect(queue.cancel('C')).toBe(true);
    expect(queue.cancel('A')).toBe(false); // running, not queued
    held.clear();
    queue.poke();
    expect(queue.state()).toEqual({ running: ['A', 'B', 'D'], queued: [] });
  });

  it('settles a synchronously failed owner and lets independent work finish', async () => {
    const queue = new RunQueue({
      canRun: () => undefined,
      start: (id) => {
        if (id === 'A') throw new Error('no worktree');
        return Promise.resolve();
      },
    });
    queue.enqueue(['A', 'B']);
    await queue.idle();
    expect(queue.state()).toEqual({ running: [], queued: [] });
  });

  it('a held-back task keeps its place while later ones start, and starts after a poke', async () => {
    const held = new Set(['B']);
    const runs = controlledRuns();
    const queue = new RunQueue({
      canRun: () => undefined,
      blocked: (id) => held.has(id),
      start: runs.start,
    });
    queue.enqueue(['A', 'B', 'C']);
    expect(queue.state()).toEqual({ running: ['A', 'C'], queued: ['B'] });

    await runs.finish('A');
    expect(queue.state()).toEqual({ running: ['C'], queued: ['B'] });

    held.clear();
    queue.poke();
    expect(queue.state()).toEqual({ running: ['C', 'B'], queued: [] });
  });
});
