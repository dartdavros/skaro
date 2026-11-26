import type { AppDb, CoordinationOperation, ResourceLease } from '@skaro/core';
import { EnvironmentRegistry, type EnvironmentRecord } from './task-environment-registry';

/** A stopped waiter has never owned capacity. A released/retained grant proves no such thing. */
export function unstartedEnvironmentOperation(
  operation: CoordinationOperation,
  leases: readonly ResourceLease[],
): boolean {
  if (
    !['mcp.start_environment', 'incident.remedy'].includes(operation.action) ||
    operation.state !== 'uncertain'
  )
    return false;
  const related = leases.filter(
    (l) =>
      l.projectId === operation.projectId &&
      l.intentId === operation.id &&
      l.cost.environment > 0 &&
      l.ownerId.startsWith('environment:'),
  );
  return (
    related.length > 0 &&
    related.every(
      (l) =>
        !l.evidence &&
        (['waiting_resource', 'waiting_quota', 'cancelled'].includes(l.state) ||
          (l.state === 'stopped_by_owner' && l.reason === 'stopped_by_owner')),
    )
  );
}

/** Called only behind the singleton recovery fence, before new external work is dispatched. */
export function reconcileUnstartedEnvironments(db: AppDb, projectId: string): void {
  const pending = db.coordination.pending(projectId);
  const leases = db.admission.all();
  let records: EnvironmentRecord[] = [];
  try {
    records = new EnvironmentRegistry(db).all().filter((row) => row.projectId === projectId);
  } catch {
    // Unreadable environment metadata cannot be evidence for dispatch recovery.
  }
  for (const operation of pending) {
    const resource =
      operation.subject.kind === 'resource' && db.resources.get(operation.subject.id);
    const preflight = records.some(
      (record) =>
        (operation.action !== 'incident.remedy' ||
          (resource &&
            resource.projectId === projectId &&
            resource.kind === 'environment' &&
            resource.identity.composeProject === record.name &&
            resource.owner.id === record.taskId)) &&
        environmentPreflightFailed(operation, record, leases),
    );
    if (!preflight && !unstartedEnvironmentOperation(operation, leases)) continue;
    db.coordination.reconcile(projectId, operation.id, {
      expectedRevision: operation.revision,
      state: 'failed',
      evidence: {
        code: preflight
          ? 'environment_preflight_failed'
          : 'environment_not_dispatched_before_admission',
        refs: [operation.subject],
      },
    });
  }
}

/** Older releases recorded a Compose parsing failure in timing but omitted its operation ID. */
export function environmentPreflightFailed(
  operation: CoordinationOperation,
  record: EnvironmentRecord,
  leases: readonly ResourceLease[],
): boolean {
  if (operation.state !== 'uncertain' || operation.projectId !== record.projectId) return false;
  if (operation.action === 'incident.remedy') {
    if (
      operation.subject.kind !== 'resource' ||
      operation.scopeKey !== `remedy:${operation.subject.id}`
    )
      return false;
  } else if (
    operation.action !== 'mcp.start_environment' ||
    operation.scopeKey !== `environment:${record.taskId}`
  )
    return false;
  const timing = record.lastStart;
  if (!timing || timing.at < operation.createdAt || timing.at > operation.updatedAt) return false;
  if (timing.operationId)
    return timing.operationId === operation.id && timing.preflightFailed === true;
  if (
    operation.action !== 'incident.remedy' ||
    timing.createMs !== 0 ||
    timing.startMs !== 0 ||
    timing.readyMs !== 0 ||
    typeof timing.error !== 'string' ||
    !timing.error.startsWith('Compose port admission failed:')
  )
    return false;
  // A settled build lease associates this legacy report with the exact coordinator attempt.
  const candidates = leases.filter(
    (lease) =>
      lease.projectId === record.projectId &&
      lease.cost.build > 0 &&
      lease.createdAt <= timing.at &&
      timing.at <= lease.updatedAt,
  );
  const [lease] = candidates;
  return (
    candidates.length === 1 &&
    lease?.intentId === operation.id &&
    lease.ownerId === operation.id &&
    lease.state === 'released' &&
    lease.evidence === 'bounded_executor_settled'
  );
}
