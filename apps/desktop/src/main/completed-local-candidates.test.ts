import { expect, it } from 'vitest';
import type { Task } from '@skaro/core';
import { semanticTestObservation } from './c4-semantic-test-input';
import type { IntegrationOperation } from './integration-model';
import { criteriaRevision, type TaskResult } from './completion-store';
import { publishedLocalCandidate } from './completed-local-candidates';

// Lifecycle DTO checks only. No project, environment, source file or publication is seeded.
it('never treats readiness or a done flag alone as permission to retire a local candidate', async () => {
  const observed = await semanticTestObservation(),
    head = observed.head;
  const task: Task = {
    id: observed.impact.taskId,
    title: 'Lifecycle metadata',
    status: 'done',
    dependsOn: [],
    unblocked: false,
    archived: false,
    path: 'README.md',
    body: '## Цель\n\nСохранить проверенный результат.\n\n## Критерии приёмки\n\n- [x] Проверено.\n',
  };
  const result: TaskResult = {
    taskId: task.id,
    head,
    branch: 'metadata',
    criteria: criteriaRevision(task),
    message: 'metadata',
  };
  const op: IntegrationOperation = {
    id: head,
    projectId: observed.impact.projectId,
    taskId: task.id,
    purpose: 'local',
    base: head,
    baseHead: head,
    head,
    worktree: observed.impact.checkout,
    fingerprint: observed.architectureHash,
    state: 'ready',
    results: [],
    checks: [],
    conflicts: [],
    cursor: 0,
    needsVerification: false,
    attempts: 0,
    sequence: 0,
    updatedAt: 1,
    verification: { head, checks: [], completedAt: 1 },
  };
  expect(publishedLocalCandidate(op, task, result)).toBe(true);
  expect(publishedLocalCandidate(op, task)).toBe(false);
  expect(publishedLocalCandidate(op, { ...task, status: 'review' }, result)).toBe(false);
  expect(publishedLocalCandidate(op, { ...task, status: 'cancelled' }, result)).toBe(false);
  expect(
    publishedLocalCandidate(
      op,
      { ...task, body: task.body + '\n## Заметки\n\nНовое условие.\n' },
      result,
    ),
  ).toBe(false);
  expect(publishedLocalCandidate(op, task, { ...result, head: 'another-result' })).toBe(false);
  expect(publishedLocalCandidate({ ...op, executor: 'active' }, task, result)).toBe(false);
  expect(publishedLocalCandidate({ ...op, worker: 'active' }, task, result)).toBe(false);
  expect(publishedLocalCandidate({ ...op, publish: true }, task, result)).toBe(false);
  expect(publishedLocalCandidate({ ...op, purpose: 'publication' }, task, result)).toBe(false);
  expect(publishedLocalCandidate({ ...op, verification: undefined }, task, result)).toBe(false);
});
