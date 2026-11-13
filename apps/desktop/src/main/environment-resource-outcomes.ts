import { randomUUID } from 'node:crypto';
import type { AppDb, ResourceRecord, ResourceOutcomeInput } from '@skaro/core';
import { stickyEnvironmentReason } from './environment-resource-guard';

type Store = Pick<AppDb, 'resources'>;

export function environmentOutcome(
  db: Store,
  resource: ResourceRecord,
  action: ResourceOutcomeInput['action'],
  state: ResourceOutcomeInput['state'],
  reason: string,
): void {
  const current = db.resources.get(resource.id)!;
  if (current.generation !== resource.generation) throw new Error('Resource generation changed.');
  const sticky = stickyEnvironmentReason(current.lastOutcome?.reason);
  if (sticky) {
    reason = sticky;
    state = 'retained';
  }
  const last = current.lastOutcome;
  if (
    last?.action === action &&
    last.state === state &&
    last.reason === reason &&
    last.generation === current.generation
  )
    return;
  db.resources.recordOutcome({
    operationId: randomUUID(),
    resourceId: current.id,
    generation: current.generation,
    action,
    state,
    reason,
  });
}

export function completeEnvironmentAction(
  db: Store,
  resource: ResourceRecord,
  action: 'stop' | 'remove',
  failures: string[] = [],
  renew = false,
): void {
  let current = db.resources.get(resource.id)!;
  if (current.generation !== resource.generation) throw new Error('Resource generation changed.');
  if (stickyEnvironmentReason(current.lastOutcome?.reason))
    throw new Error('Resource ownership conflict requires an explicit resolution.');
  const retainedConsumers = current.consumers;
  if (!failures.length && action === 'remove')
    current = db.resources.update(current.id, current.revision, {
      state: 'released',
      objectIds: [],
      consumers: [],
    });
  const retention = failures
    .join(' ')
    .match(
      /\b(docker_object_(?:provenance_unverified|protected_registration|in_use|identity_changed|owner_changed)|protected_docker_object|resource_in_use|cleanup_[a-z_]+)\b/,
    )?.[1];
  environmentOutcome(
    db,
    current,
    action,
    failures.length
      ? retention
        ? 'retained'
        : 'failed'
      : action === 'remove'
        ? 'released'
        : 'stopped',
    failures.length
      ? (retention ?? 'docker_operation_failed')
      : action === 'remove'
        ? 'environment_removed'
        : 'environment_stopped',
  );
  if (!failures.length && renew) {
    current = db.resources.get(resource.id)!;
    db.resources.update(current.id, current.revision, {
      generation: current.generation + 1,
      state: 'available',
      consumers: retainedConsumers.map((consumer) => ({
        ...consumer,
        generation: current.generation + 1,
      })),
    });
  }
}
