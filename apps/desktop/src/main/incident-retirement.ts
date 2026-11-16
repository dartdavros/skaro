import type { CoordinationBlocker } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { cancelIncidentApproval } from './incident-feed';
import { taskRequestsInactive } from './task-decision-lifecycle';

export function incidentSubscribersFinished(
  ids: ReadonlySet<string>,
  tasks: readonly {
    id: string;
    status: string;
    archived: boolean;
  }[],
) {
  return (
    ids.size > 0 &&
    [...ids].every((id) => {
      const task = tasks.find((t) => t.id === id);
      return !!task && taskRequestsInactive(task);
    })
  );
}

/** A shared incident survives while any subscriber still has unfinished work. */
export async function retireTerminalIncident(ctx: TaskRunEngine, row: CoordinationBlocker) {
  if (row.state !== 'open' || !row.protocol?.subscriptions.length) return false;
  const artifacts = await ctx.project(row.projectId).store.load();
  const ids = new Set(row.protocol.subscriptions.map((s) => s.taskId));
  if (!incidentSubscribersFinished(ids, artifacts.tasks)) return false;
  const fresh = ctx.incidents.store.get(row.projectId, row.id);
  if (fresh.state !== 'open') return true;
  if (fresh.revision !== row.revision) return false;
  ctx.deps.db.settings.atomic(() => {
    ctx.deps.db.coordination.blockers.transition(row.projectId, row.id, {
      expectedRevision: row.revision,
      state: 'cancelled',
      evidence: {
        code: 'incident_subscribers_terminal',
        refs: [...ids].map((id) => ({ kind: 'task', id })),
      },
    });
    for (const s of row.protocol!.subscriptions) {
      const key = `execution.${s.runId}`;
      const state = ctx.deps.db.getSetting<
        import('./task-execution').TaskExecutionState | undefined
      >(key, undefined);
      if (state?.blockedIncident !== row.id) continue;
      const { blocked: _blocked, blockedIncident: _incident, ...retained } = state;
      ctx.deps.db.setSetting(key, { ...retained, enabled: false });
    }
  });
  if (row.protocol.decisionId)
    await cancelIncidentApproval(
      ctx,
      row,
      row.protocol.decisionId,
      'incident_subscribers_terminal',
    );
  return true;
}
