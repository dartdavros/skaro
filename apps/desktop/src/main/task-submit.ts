import type { SubmitResultArgs, SkaroScope } from '@skaro/mcp-server';
import type { TaskRunEngine } from './task-run-engine';
import { taskTool } from './task-run-access';
import { requireBuiltinSubmission } from './builtin-submission';
import { key } from './task-run-helpers';

export async function submitTaskResult(
  ctx: TaskRunEngine,
  args: SubmitResultArgs,
  scope: SkaroScope,
) {
  const latest = scope.taskId && ctx.deps.db.listRuns(scope.projectId, scope.taskId)[0];
  if (
    latest &&
    latest.agent === 'skaro' &&
    latest.id === scope.runId &&
    !ctx.active.has(key(scope.projectId, scope.taskId!))
  )
    await ctx.history.restore(scope.projectId, scope.taskId!);
  return taskTool(ctx, scope, async () => {
    const active = ctx.requireActive(scope.projectId, scope.taskId!);
    if (active.run.agent !== 'skaro') return ctx.results.submitResult(args, scope);
    return ctx.results.submitResult(args, scope, async () => {
      if (!args.criteria.length || args.criteria.some((item) => item.met))
        await requireBuiltinSubmission(
          ctx,
          active,
          scope,
          args.criteria.filter((item) => item.met).map((item) => item.number),
        );
    });
  });
}
