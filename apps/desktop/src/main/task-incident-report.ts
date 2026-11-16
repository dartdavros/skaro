import { incidentHash, type CoordinationBlocker, type IncidentProtocol } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import type { TaskIncidents, TaskBlockerDetails } from './task-incidents';
import { taskInputSnapshot } from './task-preflight-inputs';
import { incidentFailure } from './incident-failure';
import { incidentResourceVersion } from './incident-condition';
import { checkoutKey } from './task-stage';
import { rememberEnvironmentWait } from './incident-environment-wait';
import { recordTaskBlocker } from './task-blocker-receipt';
import { assertIncidentCondition } from './incident-verification-policy';

export async function reportTaskIncident(
  ctx: TaskRunEngine,
  incidents: TaskIncidents,
  active: ActiveRun,
  reason: string,
  details?: TaskBlockerDetails,
  source: 'worker' | 'controller' = 'worker',
  operationId?: string,
): Promise<CoordinationBlocker> {
  reason = active.secrets.redact(reason);
  const execution = ctx.continuation.execution(active);
  const intent = execution.intentVersion();
  const context = ctx.project(active.projectId);
  const inputs = await taskInputSnapshot(
    ctx.deps.db,
    context,
    await context.store.load(),
    active.taskId,
  ).then(
    (v) => v.version,
    () => incidentHash(['unavailable', active.run.id]),
  );
  const failure = details ?? incidentFailure(reason);
  if (details?.condition) assertIncidentCondition({ ...failure, condition: details.condition });
  const resource = details?.resourceId
    ? ctx.deps.db.resources.get(details.resourceId)
    : failure.cause === 'environment'
      ? await ctx.environments.incidentResource(checkoutKey(active)).catch(() => undefined)
      : undefined;
  if (details?.resourceId && (!resource || resource.projectId !== active.projectId))
    throw new Error('Blocker resource is outside this project');
  const subject = resource
    ? { kind: 'resource' as const, id: resource.id, version: resource.generation }
    : { kind: 'run' as const, id: active.run.id };
  const protocol: IncidentProtocol = {
    ownerPolicyRevision: incidents.policy.read(active.projectId).revision,
    cause: failure.cause,
    code: failure.code,
    resourceVersion: await incidentResourceVersion(ctx, active.projectId, subject.id),
    condition:
      failure.cause === 'environment' && !resource
        ? 'owner-evidence'
        : (details?.condition ??
          (resource && resource.kind === 'environment'
            ? 'environment-ready'
            : ['quota', 'authentication'].includes(failure.cause)
              ? 'provider-evidence'
              : 'owner-evidence')),
    phase: 'diagnosing',
    attempts: 0,
    subscriptions: [],
  };
  const subscription = {
    taskId: active.taskId,
    runId: active.run.id,
    inputs,
    intent,
  };
  const row = await incidents.store.report(
    active.projectId,
    subject,
    protocol,
    subscription,
    reason,
    source,
    operationId,
  );
  if (source === 'controller' && failure.code === 'environment_waiting_resource')
    await rememberEnvironmentWait(ctx, row);
  recordTaskBlocker(ctx.deps.db, row, subscription, reason, operationId);
  ctx.history.flush(active);
  ctx.events.settleRuntime(active);
  return row;
}
