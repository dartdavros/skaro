import { projectRecords } from './project-records';
import type { TaskRunEngine } from './task-run-engine';
import { errorText } from './session-log';

/** Resume preserved startup requests, including the known pre-session dependency failure. */
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
        const startup = ctx.startup.read(project.id, task.id);
        if (startup?.inputs.length && !startup.error) {
          ctx.queue.enqueue([`${project.id}\n${task.id}`]);
          continue;
        }
        if (await ctx.continuation.recover(project.id, task)) continue;
        // Prior versions lost the request before recording a run. Retry only this diagnosed defect.
        if (
          runtime.get(task.id)?.state !== 'failed' ||
          ctx.deps.db.listRuns(project.id, task.id).length
        )
          continue;
        const error = ctx.startup.error(project.id, task.id);
        if (!error?.startsWith(`${task.id}: dependency integration failed:`)) continue;
        const marker = `integration.legacy-start.${project.id}.${task.id}`;
        if (ctx.deps.db.getSetting(marker, false)) continue;
        ctx.startup.begin(project.id, task.id, [{ text: '' }]);
        await ctx.scheduling.start(project.id, task.id, { text: '' });
        ctx.deps.db.setSetting(marker, true);
      }
    } catch (error) {
      ctx.deps.db.addEvent(project.id, 'integration_recovery_failed', { error: errorText(error) });
      ctx.deps.notify?.('error', errorText(error));
    }
  }
}
