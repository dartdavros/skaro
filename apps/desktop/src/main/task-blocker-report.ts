import type { SkaroScope, TaskBlockerDetails, ToolResult } from '@skaro/mcp-server';
import type { TaskRunEngine } from './task-run-engine';
import { taskTool } from './task-run-access';
import { taskBlockerReceipt } from './task-blocker-receipt';

export function reportTaskBlocker(
  ctx: TaskRunEngine,
  reason: string,
  scope: SkaroScope,
  details?: TaskBlockerDetails,
  operationId?: string,
): Promise<ToolResult> {
  if (scope.kind === 'integration') return ctx.integrations.reportBlocker(reason, scope);
  return taskTool(ctx, scope, async () => {
    const active = ctx.requireActive(scope.projectId, scope.taskId!);
    if (ctx.deps.coordinators) {
      await ctx.incidents.report(active, reason, details, 'worker', operationId);
      if (operationId) {
        const receipt = taskBlockerReceipt(ctx.deps.db, scope.projectId, operationId);
        if (!receipt) throw new Error('Task blocker registration has no durable acknowledgement');
        return receipt;
      }
    } else ctx.continuation.block(active, reason);
    return {
      text: 'The external blocker is recorded. The task remains incomplete; automatic continuation is suspended. Report the precise blocker without asking for a generic continue message.',
    };
  });
}
