import type { AppDb, CoordinationBlocker } from '@skaro/core';
import { EnvironmentRegistry } from './task-environment-registry';
import { SETTLED_ENVIRONMENT_FAILURE } from './environment-remedy-receipt';

export interface EnvironmentFailureHandoff {
  operationId: string;
  error?: string;
}

/** Only an exact, completed launch grants a fresh diagnosis assignment. */
export function environmentFailureHandoff(
  db: AppDb,
  row: CoordinationBlocker,
): EnvironmentFailureHandoff | undefined {
  const id = row.protocol?.operationId;
  if (
    !id ||
    row.state !== 'open' ||
    row.subject.kind !== 'resource' ||
    row.protocol?.condition !== 'environment-ready'
  )
    return;
  const operation = db.coordination.getOperation(row.projectId, id);
  if (
    operation?.state !== 'failed' ||
    operation.action !== 'incident.remedy' ||
    operation.subject.id !== row.subject.id ||
    !['environment_preflight_failed', SETTLED_ENVIRONMENT_FAILURE].includes(
      operation.evidence?.code ?? '',
    )
  )
    return;
  const resource = db.resources.get(row.subject.id);
  if (
    resource?.projectId !== row.projectId ||
    resource.kind !== 'environment' ||
    resource.owner.kind !== 'task' ||
    resource.ownership !== 'registered'
  )
    return;
  const record = new EnvironmentRegistry(db).find({
    projectId: row.projectId,
    taskId: resource.owner.id,
  });
  const timing = record?.name === resource.identity.composeProject ? record?.lastStart : undefined;
  return {
    operationId: id,
    ...(timing?.operationId === id && typeof timing.error === 'string'
      ? { error: timing.error }
      : {}),
  };
}
