import { incidentHash } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { incidentFailure } from './incident-failure';

/** A preparation failure may exist before any native/model session; preserve the actual startup intent. */
export async function captureStartupIncident(
  ctx: TaskRunEngine,
  projectId: string,
  taskId: string,
  error: unknown,
): Promise<void> {
  if (!ctx.deps.coordinators) return;
  const active = ctx.active.get(`${projectId}\n${taskId}`);
  if (active) return ctx.incidents.failure(active, error);
  const startup = ctx.startup.read(projectId, taskId);
  if (!startup) return;
  const cause = incidentFailure(error);
  const inputVersion = incidentHash(startup.inputs.map((i) => i.commandId));
  await ctx.incidents.store.report(
    projectId,
    { kind: 'task', id: taskId },
    {
      ...cause,
      resourceVersion: incidentHash([taskId, startup.builtinAttempt, inputVersion]),
      condition: 'owner-evidence',
      phase: 'waiting',
      attempts: 0,
      subscriptions: [],
    },
    {
      taskId,
      runId: `startup:${taskId}`,
      inputs: inputVersion,
      intent: ctx.startup.cancellationEpoch(projectId, taskId),
    },
    String(error),
    'controller',
  );
}
