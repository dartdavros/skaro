import { expect, it } from 'vitest';
import {
  projects,
  tasks,
  projectId,
  taskId,
  scope,
  expectMergedWithoutCard,
} from './task-run-test-support';

const stage = async () => (await projects.get(projectId).store.readTask(taskId)).status;

it('takes a task in progress back to "Не начата" and keeps its run', async () => {
  await projects.get(projectId).store.updateTask(taskId, { status: 'in_progress' });
  projects.get(projectId).invalidate();
  await tasks.cancel(projectId, taskId);
  expect(await stage()).toBe('todo');
  expect((await tasks.open(projectId, taskId)).run).toBeDefined();
  await projects.get(projectId).store.updateTask(taskId, { status: 'review' });
  projects.get(projectId).invalidate();
  await expect(tasks.cancel(projectId, taskId)).rejects.toThrow();
});

it('merges from the board with the open merge card, and leaves a task without one to its feed', async () => {
  expect(await tasks.mergeFromBoard(projectId, taskId)).toBe('open');
  const result = await tasks.mergeTask({ summary: 'Board merge' }, scope());
  expect(result.isError).not.toBe(true);
  expect(await tasks.mergeFromBoard(projectId, taskId)).toBe('merged');
  await expectMergedWithoutCard();
});
