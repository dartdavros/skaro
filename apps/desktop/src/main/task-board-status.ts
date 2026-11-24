import { isAgentBusy, isTaskParked, type TaskStatus } from '@skaro/core';
import { serializeTaskMutation } from './project-task-mutations';
import type { TaskRunEngine } from './task-run-engine';
import { key } from './task-run-helpers';
import { parkTask } from './task-park';

/** A manual status correction changes board metadata without recording a delivery. */
export async function setTaskBoardStatus(
  ctx: TaskRunEngine,
  projectId: string,
  taskId: string,
  status: TaskStatus,
): Promise<void> {
  if (isTaskParked(status)) {
    const reached = await parkTask(ctx, projectId, taskId, status);
    if (reached.status !== status) throw new Error(`Task ${taskId} is already ${reached.status}`);
    return;
  }
  const context = ctx.project(projectId);
  const changed = await serializeTaskMutation(context, async () => {
    const task = await context.store.readTask(taskId);
    if (task.status === status) return false;
    const runtime = ctx.deps.db.getTaskRuntime(projectId).get(taskId);
    const active = ctx.active.get(key(projectId, taskId));
    if (
      isAgentBusy(runtime?.state) ||
      active?.operations.size ||
      active?.switching ||
      ctx.integrations.ownsTask(projectId, taskId)
    )
      throw new Error(
        `Stop the active run or integration for ${taskId} before changing its status.`,
      );
    await context.store.updateTaskAtomically(taskId, { status });
    if (status !== 'review' && active) ctx.results.closeMergeCard(active);
    if (runtime?.state === 'failed') ctx.setRuntime(projectId, taskId, 'idle', runtime.runId);
    ctx.deps.db.addEvent(projectId, 'task_changed', {
      task: taskId,
      status,
      previousStatus: task.status,
    });
    context.invalidate();
    return true;
  });
  if (!changed) return;
  ctx.changed(projectId, taskId);
  ctx.deps.emit('project.changed', { projectId });
  await ctx.stages.sync(projectId, taskId);
}
