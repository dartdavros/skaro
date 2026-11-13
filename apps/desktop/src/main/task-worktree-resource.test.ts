import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { initialWorktreeRegistration } from './task-worktree-resource';

it('declares a new allocation before creation without adopting existing legacy bytes', () => {
  // Pure policy inputs; no fake repository, task, checkout or service is created.
  const path = resolve(process.cwd());
  const request = { projectId: path, taskId: 'requested-task', branch: 'requested-branch' };
  const planned = initialWorktreeRegistration(request, path, false, 'requested-input-commit');
  expect(planned).toMatchObject({
    owner: { kind: 'task', id: request.taskId },
    purpose: 'worktree',
    ownership: 'registered',
    preservation: 'disposable',
    state: 'retained',
  });
  const legacy = initialWorktreeRegistration(request, path, true, 'observed-commit');
  expect(legacy).toMatchObject({
    owner: { kind: 'unknown', id: path },
    purpose: 'unknown',
    ownership: 'legacy-unverified',
    preservation: 'unknown',
    state: 'retained',
  });
  expect(legacy.source).toEqual({ commit: 'observed-commit', recovery: request.branch });
});
