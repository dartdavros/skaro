import type { AppDb, CoordinationOperation, ResourceLease } from '@skaro/core';

export const SETTLED_ENVIRONMENT_FAILURE = 'environment_start_failed_partial_effects_possible';

/** Old launches reported a failure after their bounded build executor settled. */
export function settledEnvironmentRemedy(
  db: AppDb,
  operation: CoordinationOperation,
  leases: readonly ResourceLease[],
): string | undefined {
  if (
    operation.action !== 'incident.remedy' ||
    operation.state !== 'uncertain' ||
    operation.evidence?.code !== 'dispatch_result_unknown' ||
    operation.subject.kind !== 'resource' ||
    operation.scopeKey !== `remedy:${operation.subject.id}`
  )
    return;
  const { projectId, subject } = operation;
  const resource = db.resources.get(subject.id);
  if (
    !resource ||
    resource.projectId !== projectId ||
    resource.kind !== 'environment' ||
    resource.owner.kind !== 'task' ||
    resource.ownership !== 'registered' ||
    resource.preservation !== 'disposable' ||
    subject.version !== resource.generation
  )
    return;
  const incident = db.coordination.blockers
    .list(projectId)
    .find(
      (row) =>
        row.state === 'open' &&
        row.subject.kind === 'resource' &&
        row.subject.id === subject.id &&
        row.protocol?.condition === 'environment-ready' &&
        row.protocol.operationId === operation.id,
    );
  if (!incident) return;
  const owned = leases.filter(
    (lease) =>
      lease.projectId === projectId &&
      lease.intentId === operation.id &&
      lease.ownerId === operation.id &&
      lease.cost.build > 0,
  );
  if (owned.length !== 1) return;
  const [lease] = owned;
  if (
    lease!.state !== 'released' ||
    lease!.evidence !== 'bounded_executor_settled' ||
    lease!.createdAt < operation.createdAt ||
    lease!.updatedAt > operation.updatedAt
  )
    return;
  const failures = db.events
    .since(projectId, 'incident_remedy_failed', operation.updatedAt)
    .filter(
      ({ data }) =>
        data.incident === incident.id &&
        (data.operation === operation.id ||
          (data.operation === undefined && incident.protocol!.attempts === 1)),
    );
  const fingerprint = failures.length === 1 ? failures[0]?.data.error : undefined;
  return typeof fingerprint === 'string' && /^[a-f0-9]{64}$/.test(fingerprint)
    ? fingerprint
    : undefined;
}
