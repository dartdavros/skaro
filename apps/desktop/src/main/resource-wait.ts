import type { ResourceLease } from '@skaro/core';
import type { ResourceWait } from '../shared/resource-wait';

/** Only a concrete ownership/cleanup conflict can wait; capacity never does. */
export function resourceWait(lease: ResourceLease): ResourceWait {
  return { reason: lease.reason, since: lease.createdAt, disks: [] };
}
