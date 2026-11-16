import type { CoordinationBlocker } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { currentIncidentSubscriber } from './incident-condition';
import { incidentDiagnosisId, incidentModelPlan } from './incident-model-plan';
import { queueOwnerMessage } from './owner-commands';
import { requireCoordinationDispatch } from './coordination-dispatch';

/** One durable model assignment for the exact incident, never an unbounded retry loop. */
export async function diagnoseIncident(ctx: TaskRunEngine, row: CoordinationBlocker) {
  if (['owner-decision', 'permission', 'secret'].includes(row.protocol!.cause)) return false;
  if (incidentModelPlan(ctx.deps.db, row)) return true;
  requireCoordinationDispatch(ctx.deps.db, row.projectId);
  const commandId = incidentDiagnosisId(row);
  if (ctx.deps.db.commands.get(commandId)) return false;
  for (const subscription of row.protocol!.subscriptions) {
    if (!(await currentIncidentSubscriber(ctx, row.projectId, subscription))) continue;
    const active = await ctx.history.restore(row.projectId, subscription.taskId);
    if (!active || active.timeline.state.interactions.length) continue;
    const execution = ctx.continuation.execution(active).read();
    const assignment = {
      incident: row.id,
      run: subscription.runId,
      intent: subscription.intent,
      resourceVersion: row.protocol!.resourceVersion,
      policyRevision: row.protocol!.ownerPolicyRevision,
    };
    ctx.deps.db.settings.atomic(() => {
      ctx.deps.db.setSetting(`incident.diagnosis.${commandId}`, assignment);
      queueOwnerMessage('task.send', row.projectId, subscription.taskId, {
        commandId,
        internal: true,
        text:
          'Skaro project coordinator assigns diagnosis of incident ' +
          row.id +
          '. ' +
          'The task is incomplete and its original continuation remains blocked. Diagnose the actual ' +
          'cause using the project instructions and real environment. Recorded failure: ' +
          execution.blocked +
          '. ' +
          'Do not repeat a command with an uncertain outcome, override Stop, a denial, credentials or permissions. ' +
          'If repair is already authorized, perform it with the normal scoped tools, then call verify_project_incident. ' +
          'For an owner decision call plan_project_incident with your concrete diagnosis, smallest actionable question ' +
          'and two or three real actions with consequences; Skaro will show that existing question card. ' +
          'Never emit a generic blocker code or ask the owner to invent a solution. For a checkable external ' +
          'prerequisite, bind an existing configured project check by name using plan_project_incident; do not invent a check. ' +
          'Repair alone is not success: verify_project_incident must confirm the recorded condition before continuation. ' +
          'Do not call submit_result or resume_task to bypass this incident. End after the plan or verified repair.',
      });
    });
    return false;
  }
  return false;
}

export function incidentDiagnosisCurrent(ctx: TaskRunEngine, run: string, command: string) {
  const assignment = ctx.deps.db.getSetting<
    | {
        incident: string;
        run: string;
        intent: number;
        resourceVersion: string;
        policyRevision: number;
      }
    | undefined
  >(`incident.diagnosis.${command}`, undefined, { strict: true });
  if (!assignment || assignment.run !== run) return false;
  const active = ctx.deps.db.getRun(run);
  if (!active) return false;
  const row = ctx.deps.db.coordination.blockers.get(active.projectId, assignment.incident);
  const execution = ctx.continuation.execution(ctx.requireActive(active.projectId, active.taskId));
  return (
    row?.state === 'open' &&
    execution.read().enabled &&
    execution.intentVersion() === assignment.intent &&
    execution.read().blockedIncident === row.id &&
    row.protocol?.resourceVersion === assignment.resourceVersion &&
    row.protocol.ownerPolicyRevision === assignment.policyRevision
  );
}
