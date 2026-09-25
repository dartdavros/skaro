import { describe, expect, it } from 'vitest';
import type { Task } from './artifacts/model.ts';
import {
  dependencyCycles,
  displayStatus,
  indexTasks,
  isBlocked,
  milestoneProgress,
  newlyUnblocked,
  startBlocker,
  wouldCreateCycle,
} from './status.ts';

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    status: 'todo',
    dependsOn: [],
    unblocked: false,
    archived: false,
    body: '',
    path: '',
    ...patch,
  };
}

describe('blocked', () => {
  const done = task('T-1', { status: 'done' });
  const running = task('T-2', { status: 'in_progress' });

  it('blocks a not-started task with unfinished dependencies', () => {
    const t = task('T-3', { dependsOn: ['T-1', 'T-2'] });
    const index = indexTasks([done, running, t]);
    expect(isBlocked(t, index)).toBe(true);
    expect(displayStatus(t, index)).toBe('blocked');
    expect(startBlocker(t, index)).toBe('blocked');
  });

  it('does not block when all dependencies are done', () => {
    const t = task('T-3', { dependsOn: ['T-1'] });
    expect(isBlocked(t, indexTasks([done, t]))).toBe(false);
  });

  it('treats unknown dependencies as unfinished', () => {
    const t = task('T-3', { dependsOn: ['T-404'] });
    expect(isBlocked(t, indexTasks([t]))).toBe(true);
  });

  it('lets the user unblock a task', () => {
    const t = task('T-3', { dependsOn: ['T-2'], unblocked: true });
    expect(isBlocked(t, indexTasks([running, t]))).toBe(false);
  });

  it('only blocks tasks that have not started', () => {
    const t = task('T-3', { dependsOn: ['T-2'], status: 'review' });
    expect(isBlocked(t, indexTasks([running, t]))).toBe(false);
  });
});

describe('display status and start', () => {
  const t = task('T-1');
  const index = indexTasks([t]);

  it('reflects runtime state first', () => {
    expect(displayStatus(t, index, 'waiting')).toBe('needs_answer');
    expect(displayStatus(t, index, 'queued')).toBe('queued');
    expect(displayStatus(t, index, 'running')).toBe('in_progress');
    expect(displayStatus(t, index)).toBe('todo');
  });

  it('refuses to start archived, done or running tasks', () => {
    expect(startBlocker(task('A', { archived: true }), index)).toBe('archived');
    expect(startBlocker(task('B', { status: 'done' }), index)).toBe('already_done');
    expect(startBlocker(task('C', { status: 'review' }), index)).toBe('in_progress');
    expect(startBlocker(task('D', { status: 'failed' }), index)).toBeUndefined();
  });
});

describe('milestone progress', () => {
  it('counts done tasks, ignoring archived and cancelled', () => {
    const tasks = [
      task('T-1', { milestone: 'M01', status: 'done' }),
      task('T-2', { milestone: 'M01', status: 'in_progress' }),
      task('T-3', { milestone: 'M01', status: 'cancelled' }),
      task('T-4', { milestone: 'M01', archived: true }),
      task('T-5', { milestone: 'M02' }),
    ];
    expect(milestoneProgress({ id: 'M01' }, tasks)).toEqual({
      done: 1,
      total: 2,
      status: 'in_progress',
    });
    expect(milestoneProgress({ id: 'M02' }, tasks)).toEqual({ done: 0, total: 1, status: 'todo' });
    expect(milestoneProgress({ id: 'M03' }, tasks)).toEqual({ done: 0, total: 0, status: 'todo' });
    expect(milestoneProgress({ id: 'M01' }, tasks.slice(0, 1))).toEqual({
      done: 1,
      total: 1,
      status: 'done',
    });
  });
});

describe('dependency graph', () => {
  it('finds cycles', () => {
    const tasks = [
      task('A', { dependsOn: ['B'] }),
      task('B', { dependsOn: ['C'] }),
      task('C', { dependsOn: ['A'] }),
      task('D'),
    ];
    expect(dependencyCycles(tasks)).toEqual([['A', 'B', 'C', 'A']]);
    expect(dependencyCycles([task('A'), task('B', { dependsOn: ['A'] })])).toEqual([]);
  });

  it('prevents adding a dependency that closes a cycle', () => {
    const tasks = [task('A'), task('B', { dependsOn: ['A'] }), task('C', { dependsOn: ['B'] })];
    expect(wouldCreateCycle(tasks, 'A', 'C')).toBe(true);
    expect(wouldCreateCycle(tasks, 'C', 'A')).toBe(false);
    expect(wouldCreateCycle(tasks, 'A', 'A')).toBe(true);
  });

  it('lists tasks unblocked by a change', () => {
    const before = [
      task('A', { status: 'review' }),
      task('B', { dependsOn: ['A'] }),
      task('C', { dependsOn: ['A', 'X'] }),
      task('X'),
    ];
    const after = before.map((t) => (t.id === 'A' ? { ...t, status: 'done' as const } : t));
    expect(newlyUnblocked(before, after)).toEqual(['B']);
  });
});
