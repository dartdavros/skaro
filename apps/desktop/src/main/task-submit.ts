import type { SubmitResultArgs, SkaroScope } from '@skaro/mcp-server';
import type { TaskRunEngine } from './task-run-engine';
import { taskTool } from './task-run-access';
import { requireBuiltinSubmission } from './builtin-submission';
import { key } from './task-run-helpers';
import { C4ValidationError } from '@skaro/core';
import { c4ToolFailure, recordC4Diagnostic } from './c4-tool-diagnostic';
import { verifyPrerequisites } from './task-preflight-inputs';

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
  try {
    return await taskTool(ctx, scope, async () => {
      const active = ctx.requireActive(scope.projectId, scope.taskId!);
      const context = ctx.project(scope.projectId);
      if (args.criteria.every((item) => item.met))
        await verifyPrerequisites(
          await context.store.load(),
          active.taskId,
          active.run.worktree ?? context.root,
          'result',
        );
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
  } catch (error) {
    if (!(error instanceof C4ValidationError)) throw error;
    recordC4Diagnostic(ctx.deps.db, scope, { ...error.diagnostic, stage: 'submission' });
    ctx.changed(scope.projectId, scope.taskId!);
    return c4ToolFailure(error);
  }
}
