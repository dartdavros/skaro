import type { AppDb, ResourceLease } from '@skaro/core';
import type { ResourceManager } from './resource-manager';
import type { HeldResource } from './resource-execution';

export function resourceHolding(
  db: AppDb,
  manager: ResourceManager,
  lease: ResourceLease,
): HeldResource {
  const held: HeldResource = {
    lease,
    isLive: () => db.admission.isLive(held.lease),
    bind: (locks) => {
      const current = db.admission.get(lease.projectId, lease.id)!;
      held.lease = db.admission.bind(lease.projectId, lease.id, current.revision, locks);
    },
    release: (evidence) => {
      const current = db.admission.get(lease.projectId, lease.id)!;
      if (['released', 'stopped_by_owner'].includes(current.state)) return;
      manager.release(current, evidence);
    },
  };
  return held;
}
