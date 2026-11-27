import { expect, it } from 'vitest';
import { taskCanStop } from './task-lifecycle-actions';

it('offers Stop in the composer for tasks that can be stopped', () => {
  const task = { archived: false, stage: 'todo', status: 'todo' } as const;
  expect(taskCanStop(task)).toBe(false);
  expect(taskCanStop({ ...task, status: 'queued' })).toBe(true);
  expect(taskCanStop({ ...task, stage: 'in_progress', status: 'needs_answer' })).toBe(true);
  expect(taskCanStop({ ...task, stage: 'paused', status: 'paused' })).toBe(true);
  expect(taskCanStop({ ...task, stage: 'stopped', status: 'stopped' })).toBe(false);
  expect(taskCanStop({ ...task, stage: 'stopped', status: 'queued' })).toBe(true);
  expect(taskCanStop({ ...task, stage: 'review', status: 'in_progress' })).toBe(false);
  expect(taskCanStop({ ...task, archived: true, status: 'queued' })).toBe(false);
  expect(taskCanStop({ ...task, stage: 'stopped', lifecyclePending: true })).toBe(true);
});
