import { describe, expect, it } from 'vitest';
import type { TaskSummary } from '../../../shared/ipc';
import { moveOf } from './board-moves';

const task = (patch: Partial<TaskSummary>): TaskSummary => ({
  id: 'T-001',
  title: 'Task',
  status: 'todo',
  stage: 'todo',
  archived: false,
  deps: [],
  waitsFor: [],
  updatedAt: 0,
  ...patch,
});

describe('board moves', () => {
  it('starts a ready task, never a blocked one', () => {
    expect(moveOf(task({}), 'todo', 'working')).toBe('start');
    expect(moveOf(task({ status: 'blocked', waitsFor: ['T-000'] }), 'todo', 'working')).toBe(
      undefined,
    );
  });

  it('cancels a started task, merges one in review and keeps "На ревью" for the agent', () => {
    const working = task({ status: 'in_progress', stage: 'in_progress' });
    expect(moveOf(working, 'working', 'todo')).toBe('cancel');
    expect(moveOf(working, 'working', 'review')).toBe(undefined);
    expect(moveOf(working, 'working', 'done')).toBe(undefined);
    const review = task({ status: 'review', stage: 'review' });
    expect(moveOf(review, 'review', 'done')).toBe('merge');
    expect(moveOf(review, 'review', 'todo')).toBe(undefined);
    expect(moveOf(task({ status: 'done', stage: 'done' }), 'done', 'review')).toBe(undefined);
    expect(moveOf(task({}), 'todo', 'todo')).toBe('reorder');
  });
});
