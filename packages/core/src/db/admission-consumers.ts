import type { DatabaseSync } from 'node:sqlite';
import type { ResourceConsumer } from '../resources/model.ts';
import { ownsResourceCapacity } from '../resources/admission-model.ts';
import { resourceLeaseRecords } from './admission-records.ts';

/** Metadata query only. Legacy databases remain read-only and are not migrated here. */
export function resourceLeaseConsumers(db: DatabaseSync, resourceId: string): ResourceConsumer[] {
  return resourceLeaseRecords(db)
    .filter(ownsResourceCapacity)
    .flatMap((lease) => {
      const lock = lease.locks.find((candidate) => candidate.resourceId === resourceId);
      return lock
        ? [
            {
              id: `lease:${lease.id}`,
              generation: lock.generation,
              kind: lease.cost.review > 0 ? ('preview' as const) : ('unknown' as const),
            },
          ]
        : [];
    });
}
