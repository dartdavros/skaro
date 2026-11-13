import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { isLiveResourceGrant } from './resource-live-grant.ts';
import type { ResourceLease } from '../resources/admission-model.ts';
import type { ResourceCleanupFence } from '../resources/cleanup-context.ts';
import { randomUUID } from 'node:crypto';
import type { ResourceRecord, ResourceRegistration } from '../resources/model.ts';

/** A loaded execution owns only its exact tokens, not every operation of this PID or step name. */
export const cleanupOwner = randomUUID();
export const activeCleanupTokens = new Set<string>();
export const settledCleanupTokens = new Set<string>();
export const cleanupSignature = (resource: ResourceRegistration) =>
  JSON.stringify([
    resource.projectId,
    resource.kind,
    resource.identity,
    resource.owner,
    resource.purpose,
    resource.ownership,
    resource.preservation,
    resource.source,
  ]);
export function cleanupOwnerExited(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

export function stopEnvironmentResource(resource: ResourceRecord): boolean {
  return (
    resource.kind === 'environment' &&
    !!resource.identity.composeProject &&
    resource.ownership === 'registered' &&
    resource.preservation === 'disposable' &&
    ['task', 'integration'].includes(resource.purpose) &&
    resource.owner.kind === resource.purpose
  );
}
export function cleanupAuthorityMatches(
  db: DatabaseSync,
  resource: ResourceRecord,
  actual: ResourceLease | undefined,
  expected: ResourceLease,
  mode: ResourceCleanupFence['mode'],
): boolean {
  if (!actual || actual.projectId !== resource.projectId) return false;
  const reviewStop =
    mode === 'stop' &&
    stopEnvironmentResource(resource) &&
    actual.cost.review > 0 &&
    actual.ownerId === `review:${resource.owner.id}`;
  if (mode === 'stop' && (!reviewStop || !isLiveResourceGrant(db, expected))) return false;
  const currentGrant = actual.state === 'granted' && actual.revision === expected.revision;
  const stoppedLiveReview =
    reviewStop &&
    actual.state === 'retained' &&
    actual.reason === 'stopped_by_owner' &&
    actual.revision > expected.revision &&
    isDeepStrictEqual(
      {
        ...actual,
        state: expected.state,
        reason: expected.reason,
        revision: expected.revision,
        updatedAt: expected.updatedAt,
      },
      expected,
    );
  if (!currentGrant && !stoppedLiveReview) return false;
  return actual.locks.some(
    (lock) =>
      lock.resourceId === resource.id &&
      lock.generation === resource.generation &&
      (lock.mode === 'exclusive' || reviewStop),
  );
}

export function ownsCleanupLease(
  consumerId: string,
  context: ResourceCleanupFence,
  fence?: ResourceCleanupFence,
): boolean {
  return (
    !!fence &&
    fence.token === context.token &&
    fence.owner === cleanupOwner &&
    activeCleanupTokens.has(fence.token) &&
    !!fence.authorityLeaseId &&
    consumerId === `lease:${fence.authorityLeaseId}`
  );
}
