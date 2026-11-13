import { incidentHash, type CoordinationBlocker } from '@skaro/core';
import { requireAgentId } from '@skaro/agents';
import type { TaskRunEngine } from './task-run-engine';

/** Fresh account observations only. A reset timestamp or healthy subscription is not proof of RPM availability. */
export async function checkIncidentProvider(
  ctx: TaskRunEngine,
  row: CoordinationBlocker,
): Promise<boolean> {
  const run = ctx.deps.db.listRuns(row.projectId).find((r) => r.id === row.subject.id);
  if (!run || run.agent === 'skaro') return false;
  if (!['quota', 'authentication'].includes(row.protocol!.cause)) return false;
  const adapter = ctx.deps.agents.adapter(requireAgentId(run.agent));
  const originalAccount = ctx.deps.agents.list().find((a) => a.id === run.agent)?.account;
  try {
    const status = await adapter.status();
    if (!status.authenticated || incidentHash(status.account) !== incidentHash(originalAccount))
      return false;
    if (row.protocol!.cause === 'authentication') return true;
    const started = Date.now();
    const limits = await adapter.limits(ctx.project(row.projectId).root);
    return (
      Date.parse(limits.checkedAt) >= started &&
      limits.windows.length > 0 &&
      limits.windows.every((w) => w.remainingPercent !== null && w.remainingPercent > 0)
    );
  } catch {
    return false;
  }
}
