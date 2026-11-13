import type { ResourceLeaseRequest } from '@skaro/core';
import type { ManagedArtifact } from './managed-cache-store';

/** Additive host lifetime constraints: cannot replace task authority, admission, stop or consumer checks. */
export interface ManagedCacheLifetime {
  readonly locks: ResourceLeaseRequest['locks'];
  requireCurrent(): Promise<void>;
  requireSettled(): Promise<void>;
}
/** Missing consumer PID is not evidence that partial store/target disk has been reconciled. */
export function dependencyPhaseUnsettled(
  projectId: string,
  intentId: string,
  entries: Pick<ManagedArtifact, 'projectId' | 'state' | 'consumer'>[],
) {
  return entries.some(
    (entry) =>
      entry.consumer?.intent === intentId ||
      (entry.projectId === projectId && entry.state !== 'ready'),
  );
}
