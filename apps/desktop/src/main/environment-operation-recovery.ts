import type { AppDb, CoordinationOperation, ResourceLease } from '@skaro/core';

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
  for (const operation of db.coordination.pending(projectId)) {
    if (!unstartedEnvironmentOperation(operation, db.admission.all())) continue;
    db.coordination.reconcile(projectId, operation.id, {
      expectedRevision: operation.revision,
      state: 'failed',
      evidence: { code: 'environment_not_dispatched_before_admission', refs: [operation.subject] },
    });
  }
}
