import type { SkaroScope, TaskBlockerDetails, ToolResult } from '@skaro/mcp-server';
import type { TaskRunEngine } from './task-run-engine';
import { taskTool } from './task-run-access';

export function reportTaskBlocker(
  ctx: TaskRunEngine,
  reason: string,
  scope: SkaroScope,
  details?: TaskBlockerDetails,
  _operationId?: string,
): Promise<ToolResult> {
  if (scope.kind === 'integration') return ctx.integrations.reportBlocker(reason, scope);
  return taskTool(ctx, scope, async () => {
    const active = ctx.requireActive(scope.projectId, scope.taskId!);
    ctx.continuation.block(active, reason, details?.condition === 'environment-ready');
    return {
      text: 'The task is paused. Its blocker is recorded in the task history.',
    };
  });
}
