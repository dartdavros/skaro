import type { TaskRunEngine } from './task-run-engine';
import { projectRecords } from './project-records';
import { dispatchState } from './coordination-dispatch';
import { continueResolvedIncident } from './incident-continuation';
/** Recovery observes actual conditions first; legacy prose never becomes a repair or resume intent. */
export async function recoverCoordinatorIncidents(ctx: TaskRunEngine) {
  for await (const project of projectRecords(ctx.deps.db)) {
    if (ctx.closing) return;
    if (!dispatchState(ctx.deps.db, project.id).enabled) continue;
    for (const row of ctx.incidents.store.list(project.id)) {
      if (ctx.closing) return;
      try {
        if (row.state === 'open') await ctx.incidents.reconcile(project.id, row.id);
        else if (row.state === 'resolved') await continueResolvedIncident(ctx, row);
      } catch (error) {
        // One unavailable/stale condition cannot prevent recovery of independent subjects.
        ctx.deps.db.addEvent(project.id, 'coordinator_recovery_deferred', { incident: row.id });
        console.error('Coordinator incident recovery deferred:', row.id, error);
      }
    }
  }
}
