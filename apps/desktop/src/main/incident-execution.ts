import {
  incidentHash,
  remedyKey,
  requireRemedyDispatch,
  type CoordinationBlocker,
  type RemedyAction,
} from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import type { TaskIncidents } from './task-incidents';
import { checkIncident, currentIncidentSubscriber, incidentAction } from './incident-condition';
import { resourceExecution, resourcesFor } from './resource-execution';
import { hasEnvironmentWait } from './incident-environment-wait';
import { EnvironmentNotDispatched, EnvironmentCommandFailed } from './environment-dispatch-error';
import { incidentOperationId } from './incident-operation';
export async function executeIncident(
  ctx: TaskRunEngine,
  incidents: TaskIncidents,
  row: CoordinationBlocker,
  action: RemedyAction,
): Promise<void> {
  const id = incidentOperationId(row);
  const validate = async () => {
    const current = incidents.store.get(row.projectId, row.id);
    const fresh = await incidentAction(ctx, current);
    if (!fresh || remedyKey(action) !== remedyKey(fresh))
      throw new Error('Remedy action changed before dispatch');
    if (!hasEnvironmentWait(ctx, current, action, true))
      requireRemedyDispatch(
        action,
        fresh,
        incidents.policy.read(row.projectId),
        incidents.policy.approval(action),
        Date.now(),
      );
    if (ctx.closing || current.state !== 'open' || !fresh)
      throw new Error('Remedy authority changed before dispatch');
    let active = false;
    for (const s of current.protocol!.subscriptions)
      if (await currentIncidentSubscriber(ctx, row.projectId, s)) active = true;
    if (!active) throw new Error('Remedy has no current authorized subscriber');
  };
  row = incidents.store.update(row, {
    phase: 'executing',
    attempts: row.protocol!.attempts + 1,
    operationId: id,
  });
  let environmentEntered = false;
  try {
    await ctx.deps.coordinators!.execute(
      {
        id,
        projectId: row.projectId,
        action: 'incident.remedy',
        source: { kind: 'controller', id: 'project-coordinator' },
        subject: row.subject,
        scopeKey: `remedy:${action.target}`,
        mode: 'control',
        inputHash: remedyKey(action),
      },
      async () => {
        const resources = resourcesFor(ctx.deps.db);
        if (!resources) throw new Error('Remedy requires resource admission');
        await resources.scope(
          row.projectId,
          id,
          async () => {
            await validate();
            if (action.kind === 'environment.start') {
              const resource = ctx.deps.db.resources.get(action.target)!;
              if (resource.kind !== 'environment' || resource.owner.kind !== 'task')
                throw new Error('Only registered task environments can be started');
              environmentEntered = true;
              await ctx.environments.start(
                {
                  projectId: row.projectId,
                  taskId: resource.owner.id,
                },
                { assertActive: validate },
              );
            }
            row = incidents.store.update(incidents.store.get(row.projectId, row.id), {
              phase: 'verifying',
            });
            await resourceExecution.getStore()?.requireCurrent();
            if (!(await checkIncident(ctx, row)))
              throw new Error('Remedy did not satisfy the recorded condition');
          },
          { intentId: id, requireCurrent: validate },
        );
      },
      {
        validate,
        evidence: () => ({
          code: 'remedy_verified',
          refs: [row.subject],
          fingerprint: remedyKey(action),
        }),
        replay: () => undefined,
      },
    );
    await incidents.resolved(incidents.store.get(row.projectId, row.id));
  } catch (error) {
    const operation = ctx.deps.db.coordination.getOperation(row.projectId, id);
    if (
      (error instanceof EnvironmentNotDispatched ||
        (action.kind === 'environment.start' && !environmentEntered)) &&
      operation?.state === 'uncertain'
    )
      ctx.deps.coordinators!.reconcile(
        row.projectId,
        id,
        { code: 'environment_not_dispatched_before_admission', refs: [row.subject] },
        'failed',
      );
    else if (error instanceof EnvironmentCommandFailed && operation?.state === 'uncertain')
      ctx.deps.coordinators!.reconcile(
        row.projectId,
        id,
        { code: 'environment_start_failed_partial_effects_possible', refs: [row.subject] },
        'failed',
      );
    const current = incidents.store.get(row.projectId, row.id);
    if (current.state !== 'open') return; // Owner cancellation/resolution wins a concurrent dispatch.
    incidents.store.update(current, {
      phase:
        ctx.deps.db.coordination.getOperation(row.projectId, id)?.state === 'uncertain'
          ? 'verifying'
          : current.protocol!.attempts >= 2
            ? 'exhausted'
            : 'waiting',
    });
    ctx.deps.db.addEvent(row.projectId, 'incident_remedy_failed', {
      incident: row.id,
      error: incidentHash(String(error)),
    });
  } finally {
    incidents.policy.consume(action);
  }
}
