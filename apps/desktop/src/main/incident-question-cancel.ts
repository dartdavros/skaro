import type { TaskRunEngine } from './task-run-engine';
import { cancelIncidentApproval } from './incident-feed';

/** Retire the shared request, preserving the incident and all execution/permission barriers. */
export async function cancelIncidentQuestion(
  ctx: TaskRunEngine,
  project: string,
  id: string,
  reason: string,
) {
  const decision = ctx.deps.db.coordination.decisions.get(project, id);
  if (!decision || decision.kind !== 'question' || decision.state !== 'pending') return;
  const row = ctx.incidents.store.get(project, decision.subject.id);
  await cancelIncidentApproval(ctx, row, id, reason);
}
