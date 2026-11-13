import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { resourceId, type ResourceRecord } from '@skaro/core';
import { initialWorktreeRegistration } from './task-worktree-resource';
import { taskWorktreeRemovalBlocker } from './task-worktree-deletion';

it('does not let explicit task deletion adopt legacy, permanent, or another task resources', () => {
  // Pure authority boundary; no task/worktree fixture or application state is created.
  const path = resolve(process.cwd());
  const request = { projectId: path, taskId: 'requested-task', branch: 'requested-branch' };
  const registration = initialWorktreeRegistration(request, path, false, 'input-commit');
  const resource: ResourceRecord = {
    ...registration,
    id: resourceId(registration),
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
  };
  expect(taskWorktreeRemovalBlocker(resource, request.projectId, request.taskId)).toBeUndefined();
  expect(taskWorktreeRemovalBlocker(resource, request.projectId, 'another-task')).toBeDefined();
  expect(
    taskWorktreeRemovalBlocker(
      { ...resource, preservation: 'persistent' },
      request.projectId,
      request.taskId,
    ),
  ).toBeDefined();
  expect(
    taskWorktreeRemovalBlocker(
      { ...resource, ownership: 'legacy-unverified' },
      request.projectId,
      request.taskId,
    ),
  ).toBeDefined();
  expect(
    taskWorktreeRemovalBlocker(
      { ...resource, purpose: 'project-dev' },
      request.projectId,
      request.taskId,
    ),
  ).toBeDefined();
});
