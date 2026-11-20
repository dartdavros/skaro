import type { DatabaseSync } from 'node:sqlite';
import type { ResourceLease } from '../resources/admission-model.ts';
import { validateResourceRequest } from '../resources/admission-policy.ts';

const nonnegative = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;

/** Unknown/corrupt holdings must never disappear from the capacity or cleanup guards. */
export function resourceLeaseRecord(row: Record<string, unknown>): ResourceLease {
  const value: ResourceLease = JSON.parse(String(row.value));
  validateResourceRequest(value);
  if (
    value.id !== row.id ||
    value.projectId !== row.project_id ||
    !nonnegative(row.sequence) ||
    Number(row.sequence) < 1 ||
    !nonnegative(value.revision) ||
    value.revision < 1 ||
    !nonnegative(value.createdAt) ||
    !nonnegative(value.updatedAt) ||
    value.updatedAt < value.createdAt ||
    ![
      'waiting_resource',
      'waiting_quota',
      'granted',
      'retained',
      'released',
      'stopped_by_owner',
      'cancelled',
    ].includes(value.state) ||
    typeof value.reason !== 'string' ||
    !value.reason.trim() ||
    (value.evidence !== undefined && typeof value.evidence !== 'string')
  )
    throw new Error('Stored resource lease is inconsistent');
  return { ...value, sequence: Number(row.sequence) };
}

function hasLeaseTable(db: DatabaseSync): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE name='resource_leases'").get();
}

export function resourceLeaseRecords(db: DatabaseSync): ResourceLease[] {
  if (!hasLeaseTable(db)) return [];
  return db
    .prepare('SELECT id,project_id,sequence,value FROM resource_leases ORDER BY sequence')
    .all()
    .map(resourceLeaseRecord);
}

/** The lease ID is globally unique. Validate the selected row just as for a ledger scan. */
export function resourceLeaseById(db: DatabaseSync, id: string): ResourceLease | undefined {
  if (!hasLeaseTable(db)) return undefined;
  const row = db
    .prepare('SELECT id,project_id,sequence,value FROM resource_leases WHERE id=?')
    .get(id);
  return row && resourceLeaseRecord(row);
}
