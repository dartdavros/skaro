import { incidentHash, type CoordinationBlocker } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { currentIncidentSubscriber } from './incident-condition';
import { incidentDiagnosisId, incidentModelPlan } from './incident-model-plan';
import { isWorkflowIncident } from './incident-workflow-publication';
import { queueOwnerMessage } from './owner-commands';
import { requireCoordinationDispatch } from './coordination-dispatch';
import type { EnvironmentFailureHandoff } from './environment-incident-handoff';

/** One durable model assignment for the exact incident, never an unbounded retry loop. */
export async function diagnoseIncident(
  ctx: TaskRunEngine,
  row: CoordinationBlocker,
  recovery?: EnvironmentFailureHandoff,
) {
  if (['owner-decision', 'permission', 'secret'].includes(row.protocol!.cause)) return false;
  if (!recovery && incidentModelPlan(ctx.deps.db, row)) return true;
  requireCoordinationDispatch(ctx.deps.db, row.projectId);
  const commandId = recovery
    ? `diagnose-incident-${incidentHash([incidentDiagnosisId(row), recovery.operationId])}`
    : incidentDiagnosisId(row);
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
      operationId: recovery?.operationId,
    };
    ctx.deps.db.settings.atomic(() => {
      ctx.deps.db.setSetting(`incident.diagnosis.${commandId}`, assignment);
      queueOwnerMessage('task.send', row.projectId, subscription.taskId, {
        commandId,
        internal: true,
        text: recovery
          ? environmentRepairPrompt(row.id, active.secrets.redact(recovery.error ?? ''))
          : 'Skaro project coordinator assigns diagnosis of incident ' +
            row.id +
            '. ' +
            'The task is incomplete and its original continuation remains blocked. Diagnose the actual ' +
            'cause using the project instructions and real environment. Recorded failure: ' +
            execution.blocked +
            '. ' +
            (row.protocol!.code === 'merge_conflict_stalled'
              ? 'Preserve and inspect the existing task index and worktree. Complete the authorized Git resolution without discarding either side. Once the current base is included in task HEAD and no merge remains active, call verify_project_incident; Skaro resumes the task for verification and submission. '
              : '') +
            (isWorkflowIncident(row)
              ? 'Use plan_project_incident with verification_workflow={pullRequest,head,workflow} from the recorded publication decision. Inspect the decision and respect its exact PR, commit and deployment scope. Execute the returned publication command only under that authority, then verify_project_incident. '
              : '') +
            'Do not repeat a command with an uncertain outcome, override Stop, a denial, credentials or permissions. ' +
            'If repair is already authorized, perform it with the normal scoped tools, then call verify_project_incident. ' +
            'For an owner decision call plan_project_incident with your concrete diagnosis, smallest actionable question ' +
            'and two or three real actions with consequences; Skaro will show that existing question card. ' +
            'Never emit a generic blocker code or ask the owner to invent a solution. For a checkable external ' +
            'prerequisite, bind an existing configured project check by name using plan_project_incident; do not invent a check. ' +
            'For a recorded agent process exit, bind verification_agent=true: Skaro verifies a later live native turn. ' +
            'Bind a supported verifier even when asking an owner question. Do not report another blocker for an invalid verifier; correct the plan for this same incident. ' +
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
        operationId?: string;
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
    (!assignment.operationId || row.protocol?.operationId === assignment.operationId) &&
    row.protocol?.resourceVersion === assignment.resourceVersion &&
    row.protocol.ownerPolicyRevision === assignment.policyRevision
  );
}

function environmentRepairPrompt(incident: string, error: string): string {
  return (
    `The project coordinator delegated environment recovery for incident ${incident}. ` +
    'The previous launch returned a confirmed failure. Continue the already authorized task in this checkout. ' +
    (error
      ? `Latest launch output:\n${error}\n\n`
      : 'Read the current environment and incident evidence. ') +
    'Diagnose and repair task-local prerequisites using the real project instructions. ' +
    'For a transient build or network error, make a bounded retry with start_environment. ' +
    'Use the managed environment tools and keep existing credentials, data and ownership. ' +
    'After readiness is confirmed, continue implementation, affected checks and result submission in this task. ' +
    'If an external prerequisite is still unavailable, send the precise evidence to the coordinator. ' +
    'Respect Stop and existing owner decisions. Ask only for a concrete decision or permission that remains necessary.'
  );
}
