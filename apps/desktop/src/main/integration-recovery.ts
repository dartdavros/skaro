import { projectRecords } from './project-records';
import type { TaskRunEngine } from './task-run-engine';
import { errorText } from './session-log';
import { settingsKey } from './task-run-helpers';
import { requireStartupGeneration } from './task-startup-generation';

/** Resume only preserved requests with verified current dispatch authority. */
export async function recoverIntegrationStarts(ctx: TaskRunEngine): Promise<void> {
  for await (const project of projectRecords(ctx.deps.db)) {
    try {
      const artifacts = await ctx.project(project.id).summary();
      const runtime = ctx.deps.db.getTaskRuntime(project.id);
      for (const task of artifacts.tasks) {
        // Prior versions marked an accepted result as failed: a turn broken after it, its merge.
        if (task.status === 'review' && runtime.get(task.id)?.state === 'failed')
          ctx.setRuntime(project.id, task.id, 'idle', runtime.get(task.id)?.runId);
        if (task.archived || !['todo', 'in_progress', 'failed'].includes(task.status)) continue;
        if (
          ctx.integrations.store
            .all(project.id)
            .some((op) => op.taskId === task.id && op.state !== 'stale')
        )
          continue;
        if (ctx.deps.db.getSetting(`${settingsKey(project.id, task.id)}.handoff`, null)) {
          const active = await ctx.history.restore(project.id, task.id);
          if (active) await ctx.handoff.recover(active);
        }
        const startup = ctx.startup.read(project.id, task.id);
        if (startup?.inputs.length && !startup.error) {
          try {
            requireStartupGeneration(ctx.deps.db, project.id, startup.dispatchRevision);
          } catch (error) {
            ctx.startup.fail(project.id, task.id, errorText(error));
            ctx.setRuntime(project.id, task.id, 'failed');
            continue;
          }
          ctx.queue.enqueue([`${project.id}\n${task.id}`]);
          continue;
        }
        if (await ctx.architecture.recover(project.id, task.id)) continue;
        if (await ctx.continuation.recover(project.id, task)) continue;
        // An old diagnostic is never a substitute for a preserved, current owner instruction.
      }
    } catch (error) {
      ctx.deps.db.addEvent(project.id, 'integration_recovery_failed', { error: errorText(error) });
      ctx.deps.notify?.('error', errorText(error));
    }
  }
}
