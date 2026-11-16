import { incidentHash, type CoordinationBlocker } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { incidentModelPlan } from './incident-model-plan';
import { currentIncidentSubscriber } from './incident-condition';
import { runChecks } from './check-runner';
import { requireCoordinationDispatch } from './coordination-dispatch';

/** Never execute a model-supplied command: the exact owner-configured check must still exist. */
export async function checkConfiguredIncident(ctx: TaskRunEngine, row: CoordinationBlocker) {
  const verification = incidentModelPlan(ctx.deps.db, row)?.verification;
  if (!verification) return false;
  requireCoordinationDispatch(ctx.deps.db, row.projectId);
  const context = ctx.project(row.projectId);
  const config = (await context.store.load()).config;
  if (!config.checks.some((check) => incidentHash(check) === incidentHash(verification)))
    return false;
  let checked = false;
  for (const subscription of row.protocol!.subscriptions) {
    if (!(await currentIncidentSubscriber(ctx, row.projectId, subscription))) continue;
    const active = await ctx.history.restore(row.projectId, subscription.taskId);
    if (!active || active.timeline.state.interactions.length) return false;
    const current = () => currentIncidentSubscriber(ctx, row.projectId, subscription);
    if (!(await current())) return false;
    await runChecks(active.run.worktree ?? context.root, [verification]);
    if (
      !(await current()) ||
      !(await context.store.load()).config.checks.some(
        (c) => incidentHash(c) === incidentHash(verification),
      )
    )
      return false;
    checked = true;
  }
  return checked;
}
