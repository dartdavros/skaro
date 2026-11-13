import type { DatabaseSync } from 'node:sqlite';
import {
  RESOURCE_CAPACITIES,
  type ResourceCost,
  type ResourceLease,
} from '../resources/admission-model.ts';
import { validateResourceRequest } from '../resources/admission-policy.ts';
import { resourceLeaseRecords } from './admission-records.ts';

/** Called inside the admission transaction. Splitting conserves every reserved capacity exactly. */
export function splitResourceReservation(
  db: DatabaseSync,
  now: number,
  lease: ResourceLease,
  parts: { checkpoint: string; cost: ResourceCost }[],
): ResourceLease[] {
  if (lease.state !== 'granted' || lease.locks.length || parts.length < 2 || parts.length > 4)
    throw new Error('Only an unbound grant can be split');
  const children = parts.map((part, index) => ({
    ...lease,
    ...part,
    id: `${lease.id}:${index}`,
    revision: 1,
    reason: 'reservation_transferred',
    createdAt: now,
    updatedAt: now,
  }));
  children.forEach(validateResourceRequest);
  for (const key of RESOURCE_CAPACITIES)
    if (children.reduce((sum, child) => sum + child.cost[key], 0) !== lease.cost[key])
      throw new Error('Reservation transfer must conserve capacity');
  const volumes = new Set([
    ...Object.keys(lease.cost.diskBytes),
    ...children.flatMap((child) => Object.keys(child.cost.diskBytes)),
  ]);
  for (const volume of volumes)
    if (
      children.reduce((sum, child) => sum + (child.cost.diskBytes[volume] ?? 0), 0) !==
      (lease.cost.diskBytes[volume] ?? 0)
    )
      throw new Error('Reservation transfer must conserve disk capacity');
  const released = {
    // Auxiliary pools (for example the Docker VM) obey the same conservation rule.
    ...lease,
    revision: lease.revision + 1,
    updatedAt: now,
    state: 'released',
    reason: 'reservation_transferred',
    evidence: children.map((child) => child.id).join(','),
  };
  const pools = new Set([
    ...Object.keys(lease.cost.pools ?? {}),
    ...children.flatMap((child) => Object.keys(child.cost.pools ?? {})),
  ]);
  for (const pool of pools)
    if (
      children.reduce((sum, child) => sum + (child.cost.pools?.[pool] ?? 0), 0) !==
      (lease.cost.pools?.[pool] ?? 0)
    )
      throw new Error('Reservation transfer must conserve pools');
  db.prepare('UPDATE resource_leases SET value=? WHERE id=?').run(
    JSON.stringify(released),
    lease.id,
  );
  for (const child of children)
    db.prepare('INSERT INTO resource_leases(id,project_id,value) VALUES(?,?,?)').run(
      child.id,
      child.projectId,
      JSON.stringify(child),
    );
  return resourceLeaseRecords(db).filter((value) =>
    children.some((child) => child.id === value.id),
  );
}
