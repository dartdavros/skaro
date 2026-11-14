import { ownsResourceCapacity, type ResourceBudget, type ResourceLease } from '@skaro/core';
import type { ResourceWait } from '../shared/resource-wait';

/** Explains the same physical-volume charge used by admission, including Docker disk pools. */
export function resourceWait(
  lease: ResourceLease,
  budget: ResourceBudget | undefined,
  leases: ResourceLease[],
): ResourceWait {
  const volumes = new Set([
    ...Object.keys(lease.cost.diskBytes),
    ...Object.values(budget?.poolVolumes ?? {}),
  ]);
  const cost = (row: ResourceLease, volume: string) =>
    (row.cost.diskBytes[volume] ?? 0) +
    Object.entries(budget?.poolVolumes ?? {}).reduce(
      (sum, [pool, physical]) => sum + (physical === volume ? (row.cost.pools?.[pool] ?? 0) : 0),
      0,
    );
  const disks = [...volumes].flatMap((volume) => {
    const requested = cost(lease, volume);
    if (!requested) return [];
    const reserved = leases
      .filter((row) => row.id !== lease.id && ownsResourceCapacity(row))
      .reduce((sum, row) => sum + cost(row, volume), 0);
    const available = budget?.diskBytes[volume] ?? undefined;
    const measured = budget?.disks?.[volume];
    if (available !== undefined && requested + reserved <= available) return [];
    return [
      {
        volume,
        path: measured?.path ?? volume,
        requested,
        reserved,
        available,
        free: measured?.freeBytes,
        reserve: measured?.reserveBytes,
      },
    ];
  });
  return { reason: lease.reason, since: lease.createdAt, disks };
}
