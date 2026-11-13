import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  containsPath,
  resourceId,
  type AppDb,
  type ResourceRecord,
  type ResourceRegistration,
} from '@skaro/core';
import type { WorktreeObservation } from './worktree-resource-inventory';

/** Inventory is read-only; only the owning cleanup service persists its observations. */
export function recordWorktreeObservation(db: AppDb, observation: WorktreeObservation) {
  const proposed = observation.registration;
  const id = resourceId(proposed);
  const existing = db.resources.get(id);
  if (
    !existing &&
    [
      'task-metadata-unavailable',
      'git-registration-unavailable',
      'inspection-unavailable',
    ].includes(observation.reason)
  ) {
    const key = `resources.worktreeDeferred.${id}`;
    if (db.getSetting(key, '') !== observation.reason) {
      db.addEvent(proposed.projectId, 'resource_retained', {
        kind: 'worktree',
        resourceId: id,
        reason: observation.reason,
      });
      db.setSetting(key, observation.reason);
    }
    return { record: undefined, conflict: true };
  }
  let record = existing ?? db.resources.register(proposed);
  const conflict = worktreeRegistrationConflict(existing, proposed, observation.present);
  const sourceChanged = proposed.source && !isDeepStrictEqual(record.source, proposed.source);
  if (!conflict && sourceChanged && db.resources.cleanup.read(record.id)) {
    worktreeOutcome(db, record, 'inspect', 'retained', 'cleanup-source-changed');
    return { record, conflict: true };
  }
  if (!conflict && sourceChanged)
    record = db.resources.update(record.id, record.revision, { source: proposed.source });
  worktreeOutcome(
    db,
    record,
    'inspect',
    observation.present ? 'retained' : 'observed',
    conflict ?? observation.reason,
  );
  return { record, conflict: !!conflict };
}

export function worktreeRegistrationConflict(
  record: ResourceRecord | undefined,
  proposed: ResourceRegistration,
  present: boolean,
): string | undefined {
  if (!record) return undefined;
  if (record.state === 'released' && present) return 'unexpected-worktree-after-release';
  if (
    record.owner.kind !== proposed.owner.kind ||
    record.owner.id !== proposed.owner.id ||
    record.purpose !== proposed.purpose ||
    record.preservation !== proposed.preservation ||
    record.ownership !== proposed.ownership
  )
    return 'registration-conflict';
  return undefined;
}

export function worktreeOutcome(
  db: AppDb,
  resource: ResourceRecord,
  action: 'inspect' | 'remove',
  state: 'retained' | 'failed' | 'released' | 'observed',
  reason: string,
) {
  const previous = db.resources.get(resource.id)?.lastOutcome;
  if (
    previous &&
    previous.generation === resource.generation &&
    previous.action === action &&
    previous.state === state &&
    previous.reason === reason
  )
    return previous;
  return db.resources.recordOutcome({
    operationId: randomUUID(),
    resourceId: resource.id,
    generation: resource.generation,
    action,
    state,
    reason,
  });
}

/** A nested separately registered resource is outside the disposable checkout contract. */
export function protectedWorktreeResource(records: ResourceRecord[], checkout: ResourceRecord) {
  const path = checkout.identity.path;
  if (!path) return true;
  return records.some(
    (record) =>
      record.id !== checkout.id &&
      record.state !== 'released' &&
      record.identity.path &&
      (containsPath(path, record.identity.path) || containsPath(record.identity.path, path)),
  );
}
