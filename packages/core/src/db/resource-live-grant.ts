import type { DatabaseSync } from 'node:sqlite';
import type { ResourceLease } from '../resources/admission-model.ts';

const live = new WeakMap<ResourceLease, { db: DatabaseSync; signature: string }>();

/** Teardown capability, not recovery evidence. Neither parsed rows nor copied objects acquire it. */
export function rememberLiveResourceGrant<T extends ResourceLease>(db: DatabaseSync, lease: T): T {
  if (lease.state === 'granted') live.set(lease, { db, signature: JSON.stringify(lease) });
  return lease;
}
export function isLiveResourceGrant(db: DatabaseSync, lease: ResourceLease): boolean {
  const captured = live.get(lease);
  return (
    captured?.db === db && lease.state === 'granted' && captured.signature === JSON.stringify(lease)
  );
}
