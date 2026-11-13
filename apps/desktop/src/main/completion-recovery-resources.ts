import type { CompletionHooks } from './completion-hooks';
import type { ProjectContext } from './projects';
import type { CompletionOperation } from './completion-store';
import { resourcesFor } from './resource-execution';
import { containsCommit } from './completion-results';
import type { ResourceLease } from '@skaro/core';

type Reservation = Pick<
  ResourceLease,
  'projectId' | 'state' | 'checkpoint' | 'locks' | 'cost' | 'ownerId'
>;
export function completedPublicationReservation(
  project: string,
  lease: Reservation,
  operation: CompletionOperation,
) {
  return (
    lease.projectId === project &&
    lease.state === 'retained' &&
    lease.checkpoint === 'worktree' &&
    !lease.locks.length &&
    !lease.cost.model &&
    !lease.cost.environment &&
    !lease.cost.build &&
    !lease.cost.review &&
    operation.state === 'completed' &&
    !operation.external &&
    !!operation.commit &&
    operation.results.length === 1 &&
    lease.ownerId === `publication:${operation.results[0]!.head}`
  );
}

/** A recovered completed publication no longer needs its old execution reservation.
 * This releases ledger capacity only; retained physical checkouts are not deleted or called free space.
 */
export async function reconcileCompletedPublicationResources(
  context: ProjectContext,
  hooks: CompletionHooks,
  operations: CompletionOperation[],
) {
  const resources = resourcesFor(hooks.deps.db);
  if (!resources) return;
  const completed = new Map(
    operations
      .filter(
        (op) => op.state === 'completed' && !op.external && !!op.commit && op.results.length === 1,
      )
      .map((op) => [`publication:${op.results[0]!.head}`, op]),
  );
  const retained = hooks.deps.db.admission
    .all()
    .filter(
      (lease) =>
        completed.has(lease.ownerId) &&
        completedPublicationReservation(context.id, lease, completed.get(lease.ownerId)!),
    );
  for (const lease of retained) {
    const operation = completed.get(lease.ownerId)!;
    if (!(await containsCommit(context, operation.base, operation.commit!))) continue;
    resources.manager.release(lease, 'completed_publication_and_index_recovery_verified');
    hooks.deps.db.addEvent(context.id, 'publication_resources_reconciled', {
      operation: operation.id,
      commit: operation.commit,
      lease: lease.id,
      physicalCheckouts: 'preserved',
    });
  }
}
