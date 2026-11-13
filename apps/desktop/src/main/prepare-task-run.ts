import { assertWorkflowGraph } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import { IntegrationPending } from './integration-model';
import { prepareTaskDependencies } from './task-dependency-checkout';
import { findTask } from './task-run-helpers';

export async function prepareQueuedTask(ctx: TaskRunEngine, active: ActiveRun): Promise<boolean> {
  const artifacts = await ctx.project(active.projectId).store.load();
  assertWorkflowGraph(artifacts.tasks, artifacts.config.workflow, active.taskId);
  if (!active.run.worktree) return true;
  try {
    await prepareTaskDependencies(
      ctx,
      active.projectId,
      findTask(artifacts, active.taskId),
      artifacts,
      active.run.worktree,
    );
    return true;
  } catch (error) {
    if (error instanceof IntegrationPending) return false;
    throw error;
  }
}
