import {
  COMPOSE_PROJECT,
  sameDockerObject,
  type AppDb,
  type DockerObjectIdentity,
  type DockerObjectKind,
  type ResourceRecord,
} from '@skaro/core';

export interface DockerObjectProof {
  resourceId: string;
  generation: number;
  declaration: string;
  origin: 'managed-create';
  object: DockerObjectIdentity;
}
export interface DockerObjectDeclaration {
  volumes: string[];
  networks: string[];
  images: { name: string; service: string }[];
}
export const dockerProofKey = (resource: ResourceRecord) =>
  `resource.docker.provenance.${resource.id}.${resource.generation}`;
export const dockerObservationKey = (resource: ResourceRecord) =>
  `resource.docker.observed.${resource.id}.${resource.generation}`;

type Store = Pick<AppDb, 'getSetting' | 'resources'>;

/** An exact created object must match a non-external declaration, not just a project label. */
export function declaredNewDockerObject(
  object: DockerObjectIdentity,
  project: string,
  before: Record<DockerObjectKind, string[]>,
  declaration: DockerObjectDeclaration,
): boolean {
  if (before[object.kind].includes(object.id) || object.labels[COMPOSE_PROJECT] !== project)
    return false;
  if (object.kind === 'volume') return declaration.volumes.includes(object.name);
  if (object.kind === 'network') return declaration.networks.includes(object.name);
  return declaration.images.some(
    (image) =>
      object.labels['com.docker.compose.service'] === image.service &&
      object.tags.some((tag) => tag === image.name || tag === `${image.name}:latest`),
  );
}

export function dockerObjectOwnershipBlocker(
  db: Store,
  resource: ResourceRecord,
  object: DockerObjectIdentity,
): string | undefined {
  const current = db.resources.get(resource.id);
  if (
    !current ||
    current.generation !== resource.generation ||
    current.state === 'released' ||
    current.ownership !== 'registered' ||
    current.preservation !== 'disposable'
  )
    return 'docker_object_owner_changed';
  const proofs = db.getSetting<DockerObjectProof[]>(dockerProofKey(current), []);
  if (
    !proofs.some(
      (proof) =>
        proof.origin === 'managed-create' &&
        proof.resourceId === current.id &&
        proof.generation === current.generation &&
        !!proof.declaration &&
        sameDockerObject({ ...proof.object, tags: object.tags }, object) &&
        object.tags.every((tag) => proof.object.tags.includes(tag)),
    )
  )
    return 'docker_object_provenance_unverified';
  for (const other of db.resources.list()) {
    if (other.id === current.id) continue;
    const registered = other.objectIds?.some((id) => id === object.id || id === object.name);
    const shared = db
      .getSetting<DockerObjectProof[]>(dockerProofKey(other), [])
      .some((proof) => proof.object.kind === object.kind && proof.object.id === object.id);
    if (registered || shared || other.identity.composeProject === object.labels[COMPOSE_PROJECT])
      return 'docker_object_protected_registration';
  }
  return undefined;
}
