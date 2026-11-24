import { expect, it } from 'vitest';
import { taskLifecycleActions } from './task-lifecycle-actions';

it('offers the owner actions for parked, queued and accepted tasks in the sidebar', () => {
  const task = { archived: false, stage: 'todo', status: 'todo' } as const;
  expect(taskLifecycleActions(task)).toEqual(['start']);
  expect(taskLifecycleActions({ ...task, status: 'queued' })).toEqual(['pause', 'stop']);
  expect(taskLifecycleActions({ ...task, stage: 'paused', status: 'paused' })).toEqual([
    'resume',
    'stop',
  ]);
  expect(taskLifecycleActions({ ...task, stage: 'stopped', status: 'stopped' })).toEqual([
    'resume',
  ]);
  expect(taskLifecycleActions({ ...task, stage: 'review', status: 'review' })).toEqual([]);
  expect(
    taskLifecycleActions({ ...task, stage: 'stopped', status: 'stopped', lifecyclePending: true }),
  ).toEqual(['stop']);
});
