import { createHash } from 'node:crypto';
import {
  dockerObjectIds,
  inspectEnvironmentObjects,
  resourceId,
  type AppDb,
  type DockerRemovalAuthorization,
  type ResourceRecord,
  type DockerObjectIdentity,
  type TaskKey,
} from '@skaro/core';
import type { EnvironmentDescription } from './task-environment-description';
import { readCompose } from './task-compose';
import {
  declaredNewDockerObject,
  dockerObjectOwnershipBlocker,
  dockerProofKey,
  dockerObservationKey,
  type DockerObjectDeclaration,
  type DockerObjectProof,
} from './environment-docker-ownership';
import type { ComposeModel } from './task-compose-ports';

type Store = Pick<AppDb, 'getSetting' | 'setSetting' | 'resources'>;
type Definitions = Record<string, { name?: string; external?: boolean }>;

/** Store only declared object identities; resolved env, secrets and full Compose config never persist. */
function declarations(model: ComposeModel, project: string): DockerObjectDeclaration {
  const named = (value: unknown) =>
    Object.entries((value ?? {}) as Definitions)
      .filter(
        ([, spec]) =>
          spec &&
          (spec.external === undefined || spec.external === false) &&
          typeof spec.name === 'string',
      )
      .map(([, spec]) => spec.name!);
  return {
    volumes: named(model.volumes),
    networks: named(model.networks),
    images: Object.entries(model.services).flatMap(([service, spec]) =>
      spec.build
        ? [{ service, name: typeof spec.image === 'string' ? spec.image : `${project}-${service}` }]
        : [],
    ),
  };
}

/** Trusted launch boundary: snapshot before effects, adopt only genuinely new declared objects. */
export class EnvironmentDockerProvenance {
  private readonly db: Store;
  constructor(db: Store) {
    this.db = db;
  }

  async begin(key: TaskKey, description: EnvironmentDescription): Promise<() => Promise<void>> {
    if (!description.compose) return async () => undefined;
    const { identity, compose } = description;
    const id = resourceId({
      projectId: key.projectId,
      kind: 'environment',
      identity: { composeProject: identity.name },
    });
    const resource = this.db.resources.get(id);
    if (
      !resource ||
      resource.ownership !== 'registered' ||
      resource.preservation !== 'disposable' ||
      resource.state === 'released' ||
      resource.owner.id !== key.taskId
    )
      throw new Error(
        'Managed Docker creation requires an exact disposable environment generation',
      );
    const expected = declarations(
      await readCompose(identity.worktree, compose.variables),
      identity.name,
    );
    const declaration = createHash('sha256').update(JSON.stringify(expected)).digest('hex');
    const before = await dockerObjectIds();
    this.requireGeneration(resource);
    this.db.setSetting(`resource.docker.creation.${resource.id}.${resource.generation}`, {
      resourceId: resource.id,
      generation: resource.generation,
      declaration,
      expected,
      before,
    });
    return async () => {
      const objects = await inspectEnvironmentObjects([identity.name]);
      this.requireGeneration(resource);
      const saved = this.db.getSetting<DockerObjectProof[]>(dockerProofKey(resource), []);
      for (const object of objects) {
        if (!declaredNewDockerObject(object, identity.name, before, expected)) continue;
        if (
          this.db.resources
            .list()
            .some(
              (other) =>
                other.id !== resource.id &&
                (other.identity.composeProject === identity.name ||
                  other.objectIds?.some((id) => id === object.id || id === object.name)),
            )
        )
          continue;
        if (
          !saved.some((proof) => proof.object.kind === object.kind && proof.object.id === object.id)
        )
          saved.push({
            resourceId: resource.id,
            generation: resource.generation,
            declaration,
            origin: 'managed-create',
            object,
          });
      }
      this.db.setSetting(dockerProofKey(resource), saved);
    };
  }

  private requireGeneration(resource: ResourceRecord): void {
    const current = this.db.resources.get(resource.id);
    if (!current || current.generation !== resource.generation || current.state === 'released')
      throw new Error('Docker creation generation changed');
  }

  removal(
    resource: ResourceRecord,
    guard: () => Promise<void>,
    retained: (reason: string) => void,
  ): DockerRemovalAuthorization {
    return {
      guard,
      retained,
      effect: () => this.db.resources.cleanup.effect(resource.id, true),
      settled: () => this.db.resources.cleanup.externalSettled(resource.id),
      observed: this.db.getSetting<DockerObjectIdentity[]>(dockerObservationKey(resource), []),
      observe: (objects) => {
        this.requireGeneration(resource);
        this.db.setSetting(dockerObservationKey(resource), objects);
      },
      authorize: async (object) => {
        await guard();
        const reason = dockerObjectOwnershipBlocker(this.db, resource, object);
        if (reason) {
          retained(reason);
          throw new Error(`Docker object retained: ${reason}`);
        }
      },
    };
  }
}
