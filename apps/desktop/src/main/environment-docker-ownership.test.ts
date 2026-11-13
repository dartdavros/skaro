import { expect, it } from 'vitest';
import { realpath } from 'node:fs/promises';
import {
  AppDb,
  COMPOSE_PROJECT,
  dockerObjectInUse,
  sameDockerObject,
  type DockerObjectIdentity,
} from '@skaro/core';
import {
  declaredNewDockerObject,
  dockerObjectOwnershipBlocker,
  dockerProofKey,
  type DockerObjectProof,
} from './environment-docker-ownership';
import { completeEnvironmentAction } from './environment-resource-outcomes';

it('requires newly created exact non-external declarations, never label-only adoption', () => {
  const project = 'disposable';
  const volume: DockerObjectIdentity = {
    kind: 'volume',
    id: 'disposable_data',
    name: 'disposable_data',
    createdAt: '2026-11-12T00:00:00Z',
    labels: { [COMPOSE_PROJECT]: project },
    tags: [],
  };
  const before = { volume: [], network: [], image: [] };
  const declared = { volumes: [volume.name], networks: [], images: [] };
  expect(declaredNewDockerObject(volume, project, before, declared)).toBe(true);
  expect(
    declaredNewDockerObject(volume, project, { ...before, volume: [volume.id] }, declared),
  ).toBe(false);
  expect(declaredNewDockerObject(volume, project, before, { ...declared, volumes: [] })).toBe(
    false,
  );
  expect(declaredNewDockerObject({ ...volume, labels: {} }, project, before, declared)).toBe(false);
  expect(sameDockerObject(volume, { ...volume, createdAt: '2026-11-12T01:00:00Z' })).toBe(false);
  expect(
    dockerObjectInUse(volume, [
      {
        Id: 'consumer',
        Name: 'unrelated-project',
        Mounts: [{ Type: 'volume', Source: '', Name: volume.name }],
      },
    ]),
  ).toBe(true);
});

it('retains unknown objects, rejects same-name replacement and protects exact registrations in real SQLite', async () => {
  const db = AppDb.open(':memory:');
  try {
    const path = await realpath(process.cwd());
    const project = db.addProject({ name: 'Skaro', path });
    const resource = db.resources.register({
      projectId: project.id,
      kind: 'environment',
      identity: { composeProject: 'disposable' },
      owner: { kind: 'task', id: 'completed' },
      purpose: 'task',
      preservation: 'disposable',
      ownership: 'registered',
      generation: 1,
      consumers: [],
      state: 'available',
    });
    const object: DockerObjectIdentity = {
      kind: 'volume',
      id: 'disposable_data',
      name: 'disposable_data',
      createdAt: '2026-11-12T00:00:00Z',
      labels: { [COMPOSE_PROJECT]: 'disposable' },
      tags: [],
    };
    expect(dockerObjectOwnershipBlocker(db, resource, object)).toBe(
      'docker_object_provenance_unverified',
    );
    db.setSetting(dockerProofKey(resource), [
      {
        resourceId: resource.id,
        generation: 1,
        declaration: 'canonical-model-revision',
        origin: 'managed-create',
        object,
      } satisfies DockerObjectProof,
    ]);
    expect(dockerObjectOwnershipBlocker(db, resource, object)).toBeUndefined();
    expect(
      dockerObjectOwnershipBlocker(db, resource, { ...object, createdAt: '2026-11-13T00:00:00Z' }),
    ).toBe('docker_object_provenance_unverified');
    db.resources.register({
      projectId: project.id,
      kind: 'environment',
      identity: { composeProject: 'persistent' },
      owner: { kind: 'project', id: project.id },
      purpose: 'project-dev',
      preservation: 'persistent',
      ownership: 'registered',
      generation: 1,
      consumers: [],
      state: 'retained',
      objectIds: [object.id],
    });
    expect(dockerObjectOwnershipBlocker(db, resource, object)).toBe(
      'docker_object_protected_registration',
    );
    completeEnvironmentAction(db, resource, 'remove', [
      'volume:disposable_data: docker_object_protected_registration',
    ]);
    expect(db.resources.get(resource.id)).toMatchObject({
      state: 'available',
      lastOutcome: {
        state: 'retained',
        reason: 'docker_object_protected_registration',
        generation: 1,
      },
    });
    const released = db.resources.update(resource.id, resource.revision, { state: 'released' });
    const next = db.resources.update(released.id, released.revision, {
      state: 'available',
      generation: 2,
    });
    expect(dockerObjectOwnershipBlocker(db, resource, object)).toBe('docker_object_owner_changed');
    expect(dockerObjectOwnershipBlocker(db, next, object)).toBe(
      'docker_object_provenance_unverified',
    );
  } finally {
    db.close();
  }
});

it('requires exact service/build tags for new images and protects cross-container network/image use', () => {
  const image: DockerObjectIdentity = {
    kind: 'image',
    id: 'sha256:owned',
    name: 'sha256:owned',
    createdAt: '2026-11-12T00:00:00Z',
    labels: { [COMPOSE_PROJECT]: 'disposable', 'com.docker.compose.service': 'web' },
    tags: ['disposable-web:latest'],
  };
  const before = { volume: [], network: [], image: [] };
  const declared = {
    volumes: [],
    networks: ['disposable_default'],
    images: [{ service: 'web', name: 'disposable-web' }],
  };
  expect(declaredNewDockerObject(image, 'disposable', before, declared)).toBe(true);
  expect(
    declaredNewDockerObject(
      { ...image, tags: ['shared-web:latest'] },
      'disposable',
      before,
      declared,
    ),
  ).toBe(false);
  const network: DockerObjectIdentity = {
    ...image,
    kind: 'network',
    id: 'network-id',
    name: 'disposable_default',
    tags: [],
  };
  expect(declaredNewDockerObject(network, 'disposable', before, declared)).toBe(true);
  const consumers = [
    {
      Id: 'unrelated',
      Name: 'other',
      Image: image.id,
      Mounts: [],
      NetworkSettings: { Networks: { shared: { NetworkID: network.id } } },
    },
  ];
  expect(dockerObjectInUse(image, consumers)).toBe(true);
  expect(dockerObjectInUse(network, consumers)).toBe(true);
  expect(sameDockerObject(image, { ...image, tags: [...image.tags, 'foreign:latest'] })).toBe(
    false,
  );
});
