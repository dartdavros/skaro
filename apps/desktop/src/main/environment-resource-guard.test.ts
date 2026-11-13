import { describe, expect, it } from 'vitest';
import type { ResourceRecord, ResourceRegistration } from '@skaro/core';
import {
  environmentResourceBlocker,
  deferEnvironmentRegistration,
  stickyEnvironmentReason,
  absentEnvironmentBlocker,
} from './environment-resource-guard';
import type { EnvironmentObservation } from './environment-resource-inventory';

// Pure authority decisions only: no service doubles, files, Docker objects or process launches.
const key = { projectId: 'project', taskId: 'task' };
const resource: ResourceRegistration = {
  projectId: key.projectId,
  kind: 'environment',
  identity: { composeProject: 'registered-environment' },
  owner: { kind: 'task', id: key.taskId },
  purpose: 'task',
  ownership: 'registered',
  preservation: 'disposable',
  generation: 1,
  consumers: [],
  state: 'available',
};
const observation: EnvironmentObservation = { resource, key };

describe('environment resource authority', () => {
  it('allows only a proved idle disposable owner', () => {
    expect(environmentResourceBlocker(key, resource, observation)).toBeUndefined();
    expect(environmentResourceBlocker(key, undefined, observation)).toBe('ownership_unverified');
    expect(environmentResourceBlocker({ ...key, taskId: 'other' }, resource, observation)).toBe(
      'ownership_unverified',
    );
  });

  it('retains a declared persistent source even when an old task registry claimed its name', () => {
    const source: EnvironmentObservation = {
      resource: {
        ...resource,
        owner: { kind: 'project', id: key.projectId },
        purpose: 'project-dev',
        preservation: 'persistent',
      },
      reason: 'persistent_source',
    };
    expect(environmentResourceBlocker(key, resource, source, true)).toBe('persistent_source');
  });

  it('does not promote unknown legacy ownership from a later observation', () => {
    const unknown = {
      ...resource,
      ownership: 'legacy-unverified',
      preservation: 'unknown',
    } as const;
    expect(environmentResourceBlocker(key, unknown, observation)).toBe('ownership_unverified');
    expect(
      environmentResourceBlocker(key, resource, {
        resource: { ...resource, owner: { kind: 'task', id: 'other' } },
      }),
    ).toBe('ownership_conflict');
  });

  it('retains resources when current metadata or Docker identity cannot be trusted', () => {
    for (const reason of [
      'metadata_unavailable',
      'docker_unavailable',
      'compose_identity_conflict',
    ])
      expect(environmentResourceBlocker(key, resource, { ...observation, reason })).toBe(reason);
  });

  it('protects every consumer except this owner during its own preparation', () => {
    const occupied: ResourceRegistration = {
      ...resource,
      consumers: [{ id: `runtime:${key.projectId}:${key.taskId}`, kind: 'agent', generation: 1 }],
    };
    expect(environmentResourceBlocker(key, occupied, observation)).toBe('resource_in_use');
    expect(environmentResourceBlocker(key, occupied, observation, true)).toBeUndefined();
    expect(
      environmentResourceBlocker(
        key,
        {
          ...occupied,
          consumers: [...occupied.consumers, { id: 'review', kind: 'preview', generation: 1 }],
        },
        observation,
        true,
      ),
    ).toBe('resource_in_use');
  });

  it('does not reuse old authority for objects reappearing after release', () => {
    expect(
      environmentResourceBlocker(
        key,
        { ...resource, state: 'released' },
        {
          resource: { ...resource, objectIds: ['observed-new-object'] },
        },
        true,
      ),
    ).toBe('unexpected_objects_after_release');
  });

  it('defers first registration only for transient missing proof, not conflicting ownership', () => {
    for (const reason of ['docker_unavailable', 'metadata_unavailable', 'checkout_unavailable'])
      expect(deferEnvironmentRegistration({ ...observation, reason })).toBe(true);
    for (const reason of [
      'compose_identity_conflict',
      'ownership_unverified',
      'registry_identity_conflict',
    ])
      expect(deferEnvironmentRegistration({ ...observation, reason })).toBe(false);
  });

  it('keeps ownership conflicts sticky while transient failures can recover', () => {
    for (const reason of [
      'ownership_conflict',
      'persistent_source_conflict',
      'source_ownership_conflict',
    ])
      expect(stickyEnvironmentReason(reason)).toBe(reason);
    expect(stickyEnvironmentReason('docker_unavailable')).toBeUndefined();
    expect(stickyEnvironmentReason('metadata_unavailable')).toBeUndefined();
  });

  it('treats never allocated ownership as absent, but retains unresolved retired evidence', () => {
    expect(absentEnvironmentBlocker(key, [], [])).toBeUndefined();
    expect(absentEnvironmentBlocker(key, ['registered-environment'], [])).toBe(
      'retired_ownership_unverified',
    );
    const record: ResourceRecord = {
      ...resource,
      id: 'record',
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(absentEnvironmentBlocker(key, [], [record])).toBe('retired_resource_retained');
    expect(
      absentEnvironmentBlocker(key, ['registered-environment'], [{ ...record, state: 'released' }]),
    ).toBeUndefined();
  });
});
