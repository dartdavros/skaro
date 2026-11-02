import type { TaskRunEngine } from './task-run-engine';
import { serializeTaskMutation } from './project-task-mutations';
import { awaitingKey, findTask, key } from './task-run-helpers';
import { ownsCheckout } from './task-stage';
import { updateSubject } from './task-subject';

/** Revoke preparation immediately, then serialize the board update with run creation. */
export async function cancelTaskRun(ctx: TaskRunEngine, projectId: string, taskId: string) {
  const context = ctx.project(projectId);
  const initial = findTask(await context.load(), taskId);
  if (initial.status !== 'in_progress' && initial.status !== 'todo')
    throw new Error('Only a task in progress can be taken back');
  await ctx.messages.interrupt(projectId, taskId);
  await ctx.reviews.stop(projectId, taskId);
  await serializeTaskMutation(context, async () => {
    const task = findTask(await context.store.load(), taskId);
    if (task.status !== 'in_progress' && task.status !== 'todo')
      throw new Error('The task changed while cancellation was pending');
    const awaiting = ctx.scheduling.awaiting(projectId);
    if (awaiting[taskId]) {
      delete awaiting[taskId];
      ctx.deps.db.setSetting(awaitingKey(projectId), awaiting);
    }
    if (task.status !== 'todo') await updateSubject(context, taskId, { status: 'todo' });
    context.invalidate();
    ctx.changed(projectId, taskId);
    await ctx.stages.sync(projectId, taskId);
  });
  // A shared stage environment still serves its other tasks.
  const run = ctx.active.get(key(projectId, taskId))?.run;
  if (!run || ownsCheckout(run))
    void ctx.environments.stop({ projectId, taskId }).catch(() => undefined);
}
