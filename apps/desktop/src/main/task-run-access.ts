import { assertQuestionsAnswered } from '@skaro/timeline';
import type { SkaroScope, ToolResult } from '@skaro/mcp-server';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import { key } from './task-run-helpers';

export async function trackRun<T>(active: ActiveRun, action: () => Promise<T>): Promise<T> {
  if (active.switching) throw new Error('The agent is being changed. Retry after the handoff.');
  const pending = Promise.resolve().then(action);
  active.operations.add(pending);
  try {
    return await pending;
  } finally {
    active.operations.delete(pending);
  }
}

export async function taskTool(
  ctx: TaskRunEngine,
  scope: SkaroScope,
  action: () => Promise<ToolResult>,
): Promise<ToolResult> {
  const active = scope.taskId && ctx.active.get(key(scope.projectId, scope.taskId));
  if (!active || active.run.id !== scope.runId || active.switching)
    return { text: 'This session is no longer the current run of the task.', isError: true };
  if (active.inputTransition)
    return { text: 'Task inputs changed. The current turn is being interrupted.', isError: true };
  assertQuestionsAnswered(active.timeline.state);
  const operation = trackRun(active, action);
  active.toolOperations.add(operation);
  try {
    return await operation;
  } finally {
    active.toolOperations.delete(operation);
  }
}
