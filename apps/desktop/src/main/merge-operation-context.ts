import { AsyncLocalStorage } from 'node:async_hooks';
import type { SkaroScope } from '@skaro/mcp-server';

const mergeRequest = new AsyncLocalStorage<{ project: string; task: string; operation: string }>();

export function withMergeOperation<T>(
  scope: SkaroScope,
  args: Record<string, unknown>,
  operation: string,
  effect: () => T,
): T {
  if (scope.kind !== 'task' || !scope.taskId || args.milestone_id || args.publication)
    return effect();
  return mergeRequest.run({ project: scope.projectId, task: scope.taskId, operation }, effect);
}

export function currentMergeOperation(project: string, task: string | undefined) {
  const request = mergeRequest.getStore();
  return request?.project === project && request.task === task ? request.operation : undefined;
}
