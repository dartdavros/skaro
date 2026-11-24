import { operationTimeout } from '@skaro/timeline';
import type { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { key } from './task-run-helpers';

/** Retire the writer before waiting for a handshake or a reader which depends on its exit. */
export async function shutdownTaskRuntime(ctx: TaskRunEngine, active: ActiveRun) {
  const { projectId, taskId } = active;
  await ctx.architecture.stop(projectId, taskId);
  await ctx.integrations.controls.interrupt(projectId, taskId);
  ctx.queue.cancel(key(projectId, taskId));
  if (active.session) {
    try {
      await operationTimeout(
        active.session.interrupt(),
        5000,
        'Native interrupt deadline exceeded',
      );
    } catch {
      ctx.deps.db.addEvent(projectId, 'task_interrupt_escalated', { task: taskId });
    }
  }
  if (active.attaching) await ctx.processes.stop(active.run.id);
  await ctx.sessions.detach(active);
}
