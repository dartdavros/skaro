import { stopOwnedEnvironment } from './environment-stop';
import { ownProjects, type DockerContainer, type TaskKey, type ResourceLease } from '@skaro/core';
import { join } from 'node:path';
import type { EnvironmentDeps } from './task-environments';
import type { EnvironmentRegistry, RetiredEnvironment } from './task-environment-registry';
import { namedContainers, taskContainers, type EnvironmentDocker } from './task-environment-docker';
import { EnvironmentProjectScope } from './task-environment-scope';
import { EnvironmentPruning } from './task-environment-prune';
import { EnvironmentResources } from './environment-resources';
import { removeCompose } from './task-compose';
import { backgroundWork, environmentJob } from './background-work';
import { absentEnvironmentBlocker } from './environment-resource-guard';
import { ResourceLifecycle } from './resource-lifecycle';
import { EnvironmentDockerProvenance } from './environment-docker-provenance';
import { disposeEnvironment } from './environment-removal';
import type { ResourceRecord, DockerRemovalExecutor } from '@skaro/core';

/** Existing lifecycle with durable ownership guards; scheduling stays in TaskEnvironments. */
export class EnvironmentResourceLifecycle {
  readonly resources: EnvironmentResources;
  readonly provenance: EnvironmentDockerProvenance;
  private readonly scope: EnvironmentProjectScope;
  private readonly pruning = new EnvironmentPruning();
  private readonly deps: EnvironmentDeps;
  private readonly registry: EnvironmentRegistry;
  private readonly docker: EnvironmentDocker;
  private readonly stopped: (key: TaskKey) => void;
  private readonly journal: ResourceLifecycle;
  constructor(
    deps: EnvironmentDeps,
    registry: EnvironmentRegistry,
    docker: EnvironmentDocker,
    stopped: (key: TaskKey) => void = () => undefined,
  ) {
    this.stopped = stopped;
    this.provenance = new EnvironmentDockerProvenance(deps.db);
    this.journal = new ResourceLifecycle(deps.db);
    this.deps = deps;
    this.registry = registry;
    this.docker = docker;
    this.scope = new EnvironmentProjectScope(deps.projectScope);
    this.resources = new EnvironmentResources({ ...deps, registry }, deps.busy);
  }

  private names() {
    return new Map(this.registry.all().map((record) => [record.name, record]));
  }

  private async inspect(): Promise<DockerContainer[]> {
    try {
      return await this.docker.inspect();
    } catch (error) {
      await this.resources.unavailable();
      throw error;
    }
  }

  async close(): Promise<void> {
    const all = await this.inspect();
    await this.resources.observe(all);
    for (const record of this.scope.records(this.registry.all())) {
      try {
        await this.stop(record, all);
      } catch {
        /* The retained/failed outcome is durable; unrelated environments still stop. */
      }
    }
  }

  async admit(key: TaskKey): Promise<void> {
    const record = this.registry.find(key);
    if (!record) throw new Error('Environment identity was not allocated.');
    await this.resources.guard(key, record.name, await this.inspect(), 'start', true);
  }

  async stop(
    key: TaskKey,
    observed?: DockerContainer[],
    consumer?: ResourceLease,
    ownerStopped = false,
  ): Promise<void> {
    this.scope.require(key);
    const record = this.registry.find(key);
    if (!record) return;
    const all = observed ?? (await this.inspect());
    const resource = await this.resources.guard(
      key,
      record.name,
      all,
      'stop',
      ownerStopped,
      consumer,
    );
    await stopOwnedEnvironment({
      db: this.deps.db,
      resource,
      journal: this.journal,
      inspect: () => this.inspect(),
      guard: async () => {
        await this.resources.guard(
          key,
          record.name,
          await this.inspect(),
          'stop',
          ownerStopped,
          consumer,
        );
      },
      execute: async () =>
        this.docker.stop(
          taskContainers(
            await this.inspect(),
            key,
            join(this.deps.dataDir, 'worktrees'),
            this.names(),
          ),
        ),
      completed: (failures) => {
        this.resources.completed(resource, 'stop', failures);
        if (!failures?.length) this.stopped(key);
      },
      teardown: ownerStopped ? consumer : undefined,
    });
  }

  async remove(key: TaskKey, preparation = false): Promise<string[]> {
    this.scope.require(key);
    const record = this.registry.find(key);
    if (!record) return ['Environment ownership is not registered.'];
    const all = await this.inspect();
    let resource;
    try {
      resource = await this.resources.guard(key, record.name, all, 'remove', preparation);
    } catch (error) {
      return [String(error)];
    }
    const owned = namedContainers(all, record.name);
    const failures = await disposeEnvironment(
      {
        db: this.deps.db,
        resource,
        docker: this.docker,
        containers: owned,
        projects: ownProjects(record.name, owned, all),
        step: this.removalSteps(key, record.name, resource, preparation),
        authorization: this.removalAuthorization(key, record.name, resource, preparation),
        inspect: () => this.inspect(),
        completed: (failures) => {
          this.resources.completed(resource, 'remove', failures, preparation);
          if (!failures.length && !preparation) this.stopped(key);
          if (!failures.length) this.registry.update(key, { created: false });
        },
      },
      preparation,
    );
    return failures;
  }

  async destroy(key: TaskKey): Promise<string[]> {
    const name = this.registry.find(key)?.name;
    // No guessing by Docker name: only genuinely absent/released ownership is a no-op.
    if (!name) {
      const retired = this.registry
        .retired()
        .filter((owner) => owner.projectId === key.projectId && owner.taskId === key.taskId)
        .map((owner) => owner.name);
      const reason = absentEnvironmentBlocker(
        key,
        retired,
        this.deps.db.resources.list(key.projectId),
      );
      return reason ? [`Environment retained: ${reason}.`] : [];
    }
    const failures = await this.remove(key);
    if (!failures.length) {
      const resource = name && this.deps.db.resources.get(this.resources.id(key.projectId, name));
      try {
        await this.retire(key);
      } catch (error) {
        if (resource)
          this.resources.outcome(resource, 'remove', 'failed', 'environment_retirement_failed');
        return [String(error)];
      }
    }
    return failures;
  }

  private async retire(key: TaskKey): Promise<void> {
    const name = this.registry.find(key)?.name;
    if (name) await removeCompose(this.deps.dataDir, name);
    this.registry.remove(key);
  }

  async reconcile(starting?: TaskKey): Promise<void> {
    let all: DockerContainer[];
    try {
      all = await this.inspect();
    } catch {
      return;
    } // inspect persisted unavailable facts for every scoped resource.
    await this.resources.observe(all); // Protect declarations before any stop/remove.
    const busy = [...this.deps.busy(), ...(starting ? [starting] : [])];
    for (const record of this.scope.records(this.registry.all())) {
      if (busy.some((key) => key.projectId === record.projectId && key.taskId === record.taskId))
        continue;
      try {
        if (await this.deps.finished(record)) {
          const job = backgroundWork.start(...environmentJob(this.deps.db, record));
          try {
            const failures = await this.destroy(record);
            if (failures.length) backgroundWork.fail(job, failures.join('; '));
            else backgroundWork.finish(job);
          } catch (error) {
            backgroundWork.fail(job, String(error));
          }
        } else await this.stop(record);
      } catch {
        /* Guards and executors persist the outcome and retain this environment. */
      }
    }
    await this.pruning.run(
      this.docker,
      this.registry,
      this.deps.finished,
      this.deps.busy,
      this.deps.projectScope,
      (owner, containers) => this.prune(owner, containers),
      () => this.inspect(),
    );
  }

  private async prune(owner: RetiredEnvironment, containers: DockerContainer[]): Promise<string[]> {
    let resource;
    try {
      resource = await this.resources.guard(owner, owner.name, containers, 'remove');
    } catch (error) {
      return [String(error)];
    }
    const failures = await disposeEnvironment({
      db: this.deps.db,
      resource,
      docker: this.docker,
      containers: [],
      projects: [owner.name],
      step: this.removalSteps(owner, owner.name, resource),
      authorization: this.removalAuthorization(owner, owner.name, resource),
      inspect: () => this.inspect(),
      completed: (failures) => this.resources.completed(resource, 'remove', failures),
    });
    return failures;
  }
  private removalAuthorization(
    key: TaskKey,
    name: string,
    resource: ResourceRecord,
    preparation = false,
  ) {
    return this.provenance.removal(
      resource,
      async () => {
        const fresh = await this.resources.guard(
          key,
          name,
          await this.inspect(),
          'remove',
          preparation,
        );
        if (fresh.generation !== resource.generation)
          throw new Error('Environment generation changed');
      },
      (reason) => this.resources.outcome(resource, 'remove', 'retained', reason),
    );
  }
  private removalSteps(
    key: TaskKey,
    name: string,
    resource: ResourceRecord,
    preparation = false,
  ): DockerRemovalExecutor {
    return (step) =>
      this.journal.run(resource, `remove.${step.step}`, {
        ...step,
        guard: this.removalAuthorization(key, name, resource, preparation).guard,
      });
  }
}
