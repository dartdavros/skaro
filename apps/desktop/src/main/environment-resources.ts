import { randomUUID } from 'node:crypto';
import {
  COMPOSE_PROJECT,
  labelsOf,
  resourceId,
  ResourceCleanupBlocked,
  type DockerContainer,
  type AppDb,
  type ResourceRecord,
  type ResourceOutcomeInput,
  type TaskKey,
  type ResourceLease,
} from '@skaro/core';
import {
  environmentResourceInventory,
  type EnvironmentInventoryDeps,
  type EnvironmentObservation,
} from './environment-resource-inventory';
import {
  environmentResourceBlocker,
  environmentCleanupOperation,
  deferEnvironmentRegistration,
  stickyEnvironmentReason,
} from './environment-resource-guard';
import { reportDeferredEnvironment } from './environment-resource-diagnostics';
import { resourcesFor } from './resource-execution';
import { environmentOutcome, completeEnvironmentAction } from './environment-resource-outcomes';

type EnvironmentResourceDeps = Omit<EnvironmentInventoryDeps, 'db'> & {
  db: EnvironmentInventoryDeps['db'] & Pick<AppDb, 'getSetting' | 'setSetting' | 'addEvent'>;
};

/** Persistent observations and guards; admission/expiring leases belong to RC-2. */
export class EnvironmentResources {
  private readonly deps: EnvironmentResourceDeps;
  private readonly busy: (stoppedReview?: TaskKey) => TaskKey[];
  constructor(deps: EnvironmentResourceDeps, busy: (stoppedReview?: TaskKey) => TaskKey[]) {
    this.deps = deps;
    this.busy = busy;
  }

  id(projectId: string, name: string): string {
    return resourceId({ projectId, kind: 'environment', identity: { composeProject: name } });
  }

  async observe(
    containers?: DockerContainer[],
    stoppedReview?: TaskKey,
  ): Promise<EnvironmentObservation[]> {
    const observations = await environmentResourceInventory(this.deps, containers);
    for (const observation of observations) {
      try {
        this.save(observation, stoppedReview);
      } catch (error) {
        if (!(error instanceof ResourceCleanupBlocked) || error.reason !== 'cleanup_in_progress')
          throw error;
        // This observation cannot change the fenced resource. Keep checking independent resources.
        observation.reason = error.reason;
      }
    }
    return observations;
  }

  private save(
    observation: EnvironmentObservation,
    stoppedReview?: TaskKey,
  ): ResourceRecord | undefined {
    const { resource, key } = observation;
    const id = this.id(resource.projectId, resource.identity.composeProject!);
    let saved = this.deps.db.resources.get(id);
    if (!saved && deferEnvironmentRegistration(observation)) {
      reportDeferredEnvironment(this.deps.db, resource, observation.reason);
      return undefined;
    }
    const runtimeId = key && `runtime:${key.projectId}:${key.taskId}`;
    const consumers = (saved?.consumers ?? resource.consumers).filter((c) => c.id !== runtimeId);
    if (
      key &&
      saved?.state !== 'released' &&
      this.busy(stoppedReview).some((k) => k.projectId === key.projectId && k.taskId === key.taskId)
    )
      consumers.push({
        id: runtimeId!,
        kind: 'unknown',
        generation: saved?.generation ?? resource.generation,
      });
    if (!saved) saved = this.deps.db.resources.register({ ...resource, consumers });
    const conflict =
      saved.ownership !== resource.ownership ||
      saved.purpose !== resource.purpose ||
      saved.preservation !== resource.preservation ||
      saved.owner.id !== resource.owner.id ||
      saved.owner.kind !== resource.owner.kind;
    const reason =
      stickyEnvironmentReason(saved.lastOutcome?.reason) ??
      (conflict
        ? resource.purpose === 'project-dev'
          ? 'persistent_source_conflict'
          : 'ownership_conflict'
        : observation.reason);
    if (!reason) reportDeferredEnvironment(this.deps.db, resource);
    const state: ResourceRecord['state'] =
      saved.state === 'released' ? 'released' : reason ? 'retained' : resource.state;
    const patch = {
      consumers,
      objectIds: saved.state === 'released' ? (saved.objectIds ?? []) : (resource.objectIds ?? []),
      state,
    };
    if (
      JSON.stringify([saved.consumers, saved.objectIds, saved.state]) !==
      JSON.stringify([patch.consumers, patch.objectIds, patch.state])
    )
      saved = this.deps.db.resources.update(saved.id, saved.revision, patch);
    this.outcome(
      saved,
      'inspect',
      reason ? 'retained' : 'observed',
      reason ?? 'inventory_observed',
    );
    return saved;
  }

  async guard(
    key: TaskKey,
    name: string,
    containers: DockerContainer[],
    action: 'start' | 'stop' | 'remove',
    ownPreparation = false,
    teardownLease?: ResourceLease,
  ): Promise<ResourceRecord> {
    const stoppedReview =
      action === 'stop' &&
      ownPreparation &&
      teardownLease?.state === 'granted' &&
      teardownLease.projectId === key.projectId &&
      teardownLease.ownerId === `review:${key.taskId}` &&
      teardownLease.cost.review > 0
        ? key
        : undefined;
    const observations = await environmentResourceInventory(this.deps, containers);
    const observation = observations.find(
      (item) =>
        item.resource.projectId === key.projectId && item.resource.identity.composeProject === name,
    );
    const savedBefore = this.deps.db.resources.get(this.id(key.projectId, name));
    const registry = this.deps.db.resources;
    const fence =
      (observation && registry.cleanup.blocking(observation.resource)) ??
      (savedBefore && registry.cleanup.blocking(savedBefore));
    if (
      fence &&
      (action === 'start' ||
        !savedBefore ||
        fence.resourceId !== savedBefore.id ||
        fence.operationId !== environmentCleanupOperation(savedBefore, action))
    )
      throw new ResourceCleanupBlocked(
        'cleanup_in_progress',
        'Environment cleanup is in progress.',
      );
    // Before reclaiming a retry, validate current observations without mutating its fenced generation.
    if (
      fence?.state === 'retry' &&
      !ownPreparation &&
      this.busy(stoppedReview).some(
        (owner) => owner.projectId === key.projectId && owner.taskId === key.taskId,
      )
    )
      throw new Error('Environment retained: resource_in_use.');
    let saved =
      observation && fence?.state !== 'retry' ? this.save(observation, stoppedReview) : savedBefore;
    // Check current Docker/registry evidence across projects without writing unrelated records.
    const identities = [...registry.list(), ...observations.map((item) => item.resource)];
    const foreign = identities.some(
      (other) => other.projectId !== key.projectId && other.identity.composeProject === name,
    );
    const protectedObject = identities.some(
      (other) =>
        (other.projectId !== key.projectId || other.identity.composeProject !== name) &&
        other.objectIds?.some(
          (id) => saved?.objectIds?.includes(id) || observation?.resource.objectIds?.includes(id),
        ),
    );
    const reason =
      stickyEnvironmentReason(saved?.lastOutcome?.reason) ??
      environmentResourceBlocker(
        key,
        saved && teardownLease
          ? {
              ...saved,
              consumers: saved.consumers.filter(
                (consumer) =>
                  !resourcesFor(this.deps.db)
                    ?.holdings(teardownLease.projectId, teardownLease.ownerId)
                    .some(
                      (held) =>
                        consumer.id === resourcesFor(this.deps.db)?.consumer(held.lease, saved!),
                    ),
              ),
            }
          : saved,
        observation,
        ownPreparation,
      ) ??
      (foreign ? 'ownership_conflict' : protectedObject ? 'protected_docker_object' : undefined);
    if (reason) {
      if (saved && !fence)
        this.outcome(saved, action === 'start' ? 'inspect' : action, 'retained', reason);
      throw new Error(`Environment retained: ${reason}.`);
    }
    if (action === 'start' && saved!.state === 'released') {
      const consumers = this.busy().some(
        (owner) => owner.projectId === key.projectId && owner.taskId === key.taskId,
      )
        ? [
            {
              id: `runtime:${key.projectId}:${key.taskId}`,
              kind: 'unknown' as const,
              generation: saved!.generation + 1,
            },
          ]
        : [];
      saved = this.deps.db.resources.update(saved!.id, saved!.revision, {
        generation: saved!.generation + 1,
        state: 'available',
        consumers,
      });
    }
    return saved!;
  }

  outcome(
    resource: ResourceRecord,
    action: ResourceOutcomeInput['action'],
    state: ResourceOutcomeInput['state'],
    reason: string,
  ): void {
    environmentOutcome(this.deps.db, resource, action, state, reason);
  }

  completed(
    resource: ResourceRecord,
    action: 'stop' | 'remove',
    failures: string[] = [],
    renew = false,
  ): void {
    completeEnvironmentAction(this.deps.db, resource, action, failures, renew);
  }

  async unavailable(): Promise<void> {
    await this.observe();
  }

  /** Called after exact source validation, before Docker starts or the data copy runs. */
  beginSource(key: TaskKey, name: string, containers: DockerContainer[]): () => void {
    const id = this.id(key.projectId, name);
    let resource = this.deps.db.resources.get(id);
    if (stickyEnvironmentReason(resource?.lastOutcome?.reason))
      throw new Error('Resource ownership conflict requires an explicit resolution.');
    if (!resource)
      resource = this.deps.db.resources.register({
        projectId: key.projectId,
        kind: 'environment',
        identity: { composeProject: name },
        owner: { kind: 'project', id: key.projectId },
        purpose: 'project-dev',
        ownership: 'registered',
        preservation: 'persistent',
        generation: 1,
        consumers: [],
        objectIds: containers.map((container) => container.Id),
        state: 'retained',
      });
    if (resource.purpose !== 'project-dev' || resource.preservation !== 'persistent') {
      this.outcome(resource, 'inspect', 'retained', 'source_ownership_conflict');
      throw new Error('Declared source conflicts with a previously registered resource.');
    }
    if (containers.some((container) => labelsOf(container)[COMPOSE_PROJECT] !== name))
      throw new Error('Source container identity changed.');
    const consumerId = `copy:${key.projectId}:${key.taskId}:${randomUUID()}`;
    const generation = resource.generation;
    this.deps.db.resources.update(id, resource.revision, {
      consumers: [...resource.consumers, { id: consumerId, kind: 'copy', generation }],
      objectIds: containers.map((container) => container.Id),
    });
    this.outcome(resource, 'inspect', 'observed', 'source_copy_started');
    return () => {
      const latest = this.deps.db.resources.get(id);
      if (!latest || latest.generation !== generation) return;
      this.deps.db.resources.update(id, latest.revision, {
        consumers: latest.consumers.filter((consumer) => consumer.id !== consumerId),
      });
      this.outcome(latest, 'inspect', 'observed', 'source_copy_released');
    };
  }
}
