import type { CoordinationBlocker } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import {
  incidentResourceVersion,
  checkIncident,
  currentIncidentSubscriber,
} from './incident-condition';
import { checkoutKey } from './task-stage';

export async function bindIncidentEnvironment(
  ctx: TaskRunEngine,
  row: CoordinationBlocker,
  id: string,
) {
  const resource = ctx.deps.db.resources.get(id);
  if (row.subject.kind === 'resource' && row.subject.id !== id)
    throw new Error('An incident cannot be verified against a different resource');
  if (
    !resource ||
    resource.projectId !== row.projectId ||
    resource.kind !== 'environment' ||
    resource.ownership !== 'registered' ||
    resource.owner.kind !== 'task' ||
    !['environment', 'external', 'dependency', 'resource'].includes(row.protocol!.cause)
  )
    throw new Error('Verification requires this incident subscriber’s registered task environment');
  for (const subscription of row.protocol!.subscriptions) {
    if (!(await currentIncidentSubscriber(ctx, row.projectId, subscription))) continue;
    const active = await ctx.history.restore(row.projectId, subscription.taskId);
    if (active && checkoutKey(active).taskId === resource.owner.id)
      return { id, version: await incidentResourceVersion(ctx, row.projectId, id) };
  }
  throw new Error('The environment does not belong to a current incident subscriber');
}

export async function checkIncidentEnvironment(
  ctx: TaskRunEngine,
  row: CoordinationBlocker,
  binding: { id: string; version: string },
) {
  const fresh = await bindIncidentEnvironment(ctx, row, binding.id);
  if (fresh.version !== binding.version) return false;
  return checkIncident(ctx, {
    ...row,
    subject: { kind: 'resource', id: binding.id },
    protocol: {
      ...row.protocol!,
      condition: 'environment-ready',
      resourceVersion: binding.version,
    },
  });
}
