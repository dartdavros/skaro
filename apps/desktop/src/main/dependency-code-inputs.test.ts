import { expect, it } from 'vitest';
import { dependencyCodeHeads } from './dependency-code-inputs';
import type { TaskResult, CompletionOperation } from './completion-store';

it('accepts only a completed publication of the same accepted SHA as an alternate ancestry proof', () => {
  const result: TaskResult = {
    taskId: 'T-010',
    head: 'accepted',
    branch: 'topic',
    criteria: 'revision',
    message: '',
  };
  const operation: CompletionOperation = {
    id: 'publication',
    base: 'main',
    results: [result],
    strategy: 'squash',
    state: 'completed',
    commit: 'squashed',
  };
  expect(dependencyCodeHeads(result, [operation])).toEqual(['accepted', 'squashed']);
  for (const state of ['preparing', 'integrating', 'prepared', 'failed', 'reverted'] as const)
    expect(dependencyCodeHeads(result, [{ ...operation, state }])).toEqual(['accepted']);
  expect(dependencyCodeHeads({ ...result, head: 'revised' }, [operation])).toEqual(['revised']);
  expect(dependencyCodeHeads({ ...result, taskId: 'T-011' }, [operation])).toEqual(['accepted']);
});
