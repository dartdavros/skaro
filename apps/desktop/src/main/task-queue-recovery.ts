import type { TaskRunEngine } from './task-run-engine';
import { projectRecords } from './project-records';
import { recoverQueuedTaskStarts } from './task-queued-start-recovery';
import { recoverTaskTransitions } from './task-lifecycle-recovery';
/** Recovery observes actual conditions first; legacy prose never becomes a repair or resume intent. */
export async function recoverTaskQueue(ctx: TaskRunEngine) {
  for await (const project of projectRecords(ctx.deps.db)) {
    if (ctx.closing) return;
    await recoverTaskTransitions(ctx, project.id);
    await recoverQueuedTaskStarts(ctx, project.id).catch((error: unknown) =>
      console.error('Queued task start recovery:', project.id, error),
    );
  }
}
