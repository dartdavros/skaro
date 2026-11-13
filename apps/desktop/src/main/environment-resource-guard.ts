import type { ResourceRecord, ResourceRegistration, TaskKey } from '@skaro/core';
import type { EnvironmentObservation } from './environment-resource-inventory';

/** Missing current observations do not permanently classify a previously unregistered resource. */
export function deferEnvironmentRegistration(observation: EnvironmentObservation): boolean {
  return [
    'docker_unavailable',
    'metadata_unavailable',
    'checkout_unavailable',
    'path_unavailable',
    'git_unavailable',
    'project_unregistered',
  ].includes(observation.reason ?? '');
}

/** Observer/retry outcomes cannot revoke a previously observed persistent-purpose conflict. */
export function stickyEnvironmentReason(reason?: string): string | undefined {
  return ['ownership_conflict', 'persistent_source_conflict', 'source_ownership_conflict'].includes(
    reason ?? '',
  )
    ? reason
    : undefined;
}

export function absentEnvironmentBlocker(
  key: TaskKey,
  retiredNames: string[],
  records: ResourceRecord[],
): string | undefined {
  const owned = records.filter(
    (record) =>
      record.projectId === key.projectId &&
      record.kind === 'environment' &&
      (record.owner.id === key.taskId ||
        retiredNames.includes(record.identity.composeProject ?? '')),
  );
  if (retiredNames.some((name) => !owned.some((record) => record.identity.composeProject === name)))
    return 'retired_ownership_unverified';
  if (
    owned.some(
      (record) =>
        record.state !== 'released' ||
        ['retained', 'failed'].includes(record.lastOutcome?.state ?? ''),
    )
  )
    return 'retired_resource_retained';
  return undefined;
}

/** Observations can restrict existing authority, never silently broaden it. */
export function environmentResourceBlocker(
  key: TaskKey,
  resource: ResourceRegistration | undefined,
  observation: EnvironmentObservation | undefined,
  ownPreparation = false,
): string | undefined {
  if (observation?.reason) return observation.reason;
  if (!resource || !observation) return 'ownership_unverified';
  if (resource.state === 'released' && observation.resource.objectIds?.length)
    return 'unexpected_objects_after_release';
  if (
    resource.preservation !== 'disposable' ||
    resource.ownership !== 'registered' ||
    resource.owner.id !== key.taskId ||
    resource.projectId !== key.projectId ||
    resource.purpose === 'project-dev'
  )
    return 'ownership_unverified';
  const current = observation.resource;
  if (
    current.owner.id !== resource.owner.id ||
    current.owner.kind !== resource.owner.kind ||
    current.purpose !== resource.purpose ||
    current.preservation !== resource.preservation ||
    current.ownership !== resource.ownership
  )
    return 'ownership_conflict';
  if (
    resource.consumers.some(
      (consumer) => !ownPreparation || consumer.id !== `runtime:${key.projectId}:${key.taskId}`,
    )
  )
    return 'resource_in_use';
  return undefined;
}
