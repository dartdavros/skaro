import type { SkaroScope } from '@skaro/mcp-server';
import type { TaskRunEngine } from './task-run-engine';
import { assertQuestionsAnswered } from '@skaro/timeline';
import { requireCoordinationDispatch } from './coordination-dispatch';
import { currentIncidentSubscriber, checkIncident } from './incident-condition';
import { checkConfiguredIncident } from './incident-configured-check';
import { incidentModelPlan } from './incident-model-plan';
import { checkIncidentEnvironment } from './incident-environment-verification';
import { DecisionNotDispatched } from './decision-not-dispatched';

export async function prepareModelIncident(ctx: TaskRunEngine, scope: SkaroScope, id: string) {
  try {
    return await readModelIncident(ctx, scope, id);
  } catch (error) {
    throw new DecisionNotDispatched(error);
  }
}
async function readModelIncident(ctx: TaskRunEngine, scope: SkaroScope, id: string) {
  requireCoordinationDispatch(ctx.deps.db, scope.projectId);
  const row = ctx.incidents.store.get(scope.projectId, id);
  if (row.state !== 'open' || !['task', 'project_chat'].includes(scope.kind))
    throw new Error('Incident is not actionable');
  if (['owner-decision', 'permission', 'secret'].includes(row.protocol!.cause))
    throw new Error('Owner decisions and pauses cannot be bypassed by incident repair');
  let current = false;
  for (const s of row.protocol!.subscriptions) {
    if (scope.kind === 'task' && (s.taskId !== scope.taskId || s.runId !== scope.runId)) continue;
    if (!(await currentIncidentSubscriber(ctx, scope.projectId, s))) continue;
    const active = await ctx.history.restore(scope.projectId, s.taskId);
    if (!active) continue;
    assertQuestionsAnswered(active.timeline.state);
    current = true;
  }
  if (!current) throw new Error('Incident has no current authorized subscriber');
  return row;
}
export async function verifyModelIncident(ctx: TaskRunEngine, scope: SkaroScope, id: string) {
  const row = await prepareModelIncident(ctx, scope, id);
  const environment = incidentModelPlan(ctx.deps.db, row)?.verificationEnvironment;
  const verified =
    row.protocol!.condition === 'owner-evidence'
      ? environment
        ? await checkIncidentEnvironment(ctx, row, environment)
        : await checkConfiguredIncident(ctx, row)
      : await checkIncident(ctx, row);
  if (!verified)
    throw new DecisionNotDispatched(
      'The recorded condition is still unsatisfied; the incident remains open',
    );
  const fresh = await prepareModelIncident(ctx, scope, id);
  if (fresh.revision !== row.revision)
    throw new DecisionNotDispatched('Incident changed during verification');
  await ctx.incidents.resolved(fresh);
}
