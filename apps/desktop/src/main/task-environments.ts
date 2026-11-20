import { existsSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { type AppDb, type EnvironmentConfig, type TaskKey } from '@skaro/core';
import type { Projects } from './projects';
import { EnvironmentRegistry } from './task-environment-registry';
import { systemDocker, type EnvironmentDocker } from './task-environment-docker';
import type { ConfigureEnvironmentArgs } from '@skaro/mcp-server';
import { configureEnvironment, recordedEnvironmentConfig } from './task-environment-config';
import {
  describeTaskEnvironment,
  recordedEnvironmentIdentity,
  type EnvironmentDescription,
} from './task-environment-description';
import { refreshEnvironmentPorts } from './task-environment-ports';
import { startEnvironmentServices, type EnvironmentStartOptions } from './task-environment-start';
import { environmentLink, environmentLinkAddress } from './task-environment-link';
import { EnvironmentProjectScope } from './task-environment-scope';
import { EnvironmentResourceLifecycle } from './environment-resource-lifecycle';
import { reportEnvironmentRegistryFailure } from './environment-resource-diagnostics';
import { EnvironmentAdmission } from './resource-environment';
import { resourceExecution, type HeldResource } from './resource-execution';
import { EnvironmentNotDispatched } from './environment-dispatch-error';
import { EnvironmentWork } from './environment-work';

export interface EnvironmentDeps {
  db: Pick<
    AppDb,
    'getSetting' | 'setSetting' | 'getProject' | 'listProjects' | 'resources' | 'addEvent'
  >;
  /** App data folder: task checkouts live in worktrees/<project>/<task>. */
  dataDir: string;
  projects: Projects;
  /** Tasks whose agent works now. */
  busy: (stoppedReview?: TaskKey) => TaskKey[];
  /** The task is merged, cancelled or gone: its environment has no reason to exist. */
  finished: (key: TaskKey) => Promise<boolean>;
  docker?: EnvironmentDocker;
  projectScope?: string;
}

export interface EnvironmentInfo {
  name: string;
  urls: Record<string, string>;
  portBindings?: Record<string, string>;
}

/** The environment cannot be started for a reason the agent should report, not retry. */
export class EnvironmentUnavailable extends Error {}

/**
 * Task environments (task-environments.md): a disposable copy of the project's services per task.
 * Skaro owns the name, published ports and data, starts it on request and stops idle services.
 */
export class TaskEnvironments {
  private readonly deps: EnvironmentDeps;
  private readonly registry: EnvironmentRegistry;
  private readonly docker: EnvironmentDocker;
  private readonly scope: EnvironmentProjectScope;
  private readonly lifecycle: EnvironmentResourceLifecycle;
  private readonly admission: EnvironmentAdmission;
  private readonly work = new EnvironmentWork();
  private allocation: Promise<unknown> = Promise.resolve();
  private maintenance?: Promise<void>;
  private closing = false;

  constructor(deps: EnvironmentDeps) {
    this.deps = deps;
    this.registry = new EnvironmentRegistry(deps.db, () =>
      reportEnvironmentRegistryFailure(deps.db, deps.projectScope),
    );
    this.docker = deps.docker ?? systemDocker;
    this.scope = new EnvironmentProjectScope(deps.projectScope);
    this.admission = new EnvironmentAdmission(deps);
    this.lifecycle = new EnvironmentResourceLifecycle(
      this.deps,
      this.registry,
      this.docker,
      (key) => this.admission.stopped(key),
      () => this.work.starting(),
    );
  }

  /** Shutdown must drain scheduled cleanup before the application's database is closed. */
  async idle(): Promise<void> {
    await Promise.allSettled([this.work.idle(), this.allocation, this.maintenance]);
  }

  /** Once agent processes have stopped, no task services may outlive the application. */
  async close(): Promise<void> {
    this.closing = true;
    await this.maintenance?.catch(() => undefined);
    await this.work.exclusive(() => this.lifecycle.close());
  }

  private serial<T>(queue: 'allocation', action: () => Promise<T>): Promise<T> {
    const next = this[queue].catch(() => undefined).then(action);
    this[queue] = next;
    return next;
  }

  /** Name and ports of the task's environment, promised on first use and kept until it is removed. */
  describe(key: TaskKey): Promise<EnvironmentDescription> {
    this.scope.require(key);
    return this.serial('allocation', () =>
      describeTaskEnvironment(
        {
          db: this.deps.db,
          context: this.deps.projects.get(key.projectId),
          dataDir: this.deps.dataDir,
          registry: this.registry,
          docker: this.docker,
        },
        key,
      ),
    );
  }

  /** Variables for the agent's shell: its own `docker compose` addresses the same environment. */
  async sessionEnv(key: TaskKey): Promise<Record<string, string>> {
    return (await this.describe(key)).variables;
  }

  /** The agent's turn began: the task counts as recently used. */
  touch(key: TaskKey): void {
    this.scope.require(key);
    this.registry.update(key, { usedAt: Date.now() });
  }

  /** Only Skaro's integration executor can bind an environment to its private candidate. */
  bindIntegration(key: TaskKey, worktree: string): void {
    this.scope.require(key);
    const suffix = relative(join(this.deps.dataDir, 'integrations', key.projectId), worktree);
    if (!key.taskId.startsWith('integration-') || suffix.startsWith('..') || isAbsolute(suffix))
      throw new Error('Integration environment must belong to its project data directory.');
    this.registry.ensure(key, this.deps.db.getProject(key.projectId)?.name ?? '');
    this.registry.update(key, { worktree });
  }

  /** Resolve only this environment's allocated host addresses; other links stay ordinary links. */
  link(key: TaskKey, url: string): string | undefined {
    this.scope.require(key);
    const record = this.registry.find(key);
    return record && environmentLink(record, url);
  }

  linkAddress(key: TaskKey, url: string, portName: string): string {
    this.scope.require(key);
    const port = this.registry.find(key)?.ports[portName];
    if (!port) throw new EnvironmentUnavailable('The environment no longer exposes this address.');
    return environmentLinkAddress(url, port);
  }

  /** Save behind this environment's start, without waiting for another task's data copy. */
  configure(key: TaskKey, args: ConfigureEnvironmentArgs): Promise<EnvironmentConfig> {
    const authority = resourceExecution.getStore();
    const read = async () => {
      const { config } = await this.describe(key);
      if (!config)
        throw new EnvironmentUnavailable('The project describes no valid task environment.');
      return config;
    };
    if (!Object.keys(args).length) return read();
    return this.work.run(key, async () => {
      await authority?.requireCurrent();
      const { identity, config } = await this.describe(key);
      if (!config)
        throw new EnvironmentUnavailable('The project describes no valid task environment.');
      if (!existsSync(identity.worktree))
        throw new EnvironmentUnavailable('The task has no checkout of its own.');
      await authority?.requireCurrent();
      configureEnvironment(this.registry, key, config, args);
      return (await this.describe(key)).config!;
    });
  }

  /** Read the existing allocation without creating a checkout, Docker ports or Compose overrides. */
  async recorded(key: TaskKey) {
    this.scope.require(key);
    const record = this.registry.find(key);
    if (!record) return undefined;
    const context = this.deps.projects.get(key.projectId);
    const base = (await context.load()).config.environment;
    return {
      identity: recordedEnvironmentIdentity(context.root, this.deps.dataDir, record),
      config: base && recordedEnvironmentConfig(record, base),
    };
  }

  /** Resolve a blocker to the actual scoped resource, without starting or adopting unknown data. */
  async incidentResource(key: TaskKey) {
    this.scope.require(key);
    const record = this.registry.find(key);
    if (!record) return undefined;
    try {
      await this.lifecycle.resources.observe(await this.docker.inspect());
    } catch {
      // Existing identity remains useful for diagnosis; absence of Docker never grants authority.
    }
    return this.deps.db.resources
      .list(key.projectId)
      .find(
        (r) =>
          r.kind === 'environment' &&
          r.identity.composeProject === record.name &&
          r.owner.id === key.taskId,
      );
  }

  /** Creates the copy on first use, starts the services and waits until they are ready. */
  async start(key: TaskKey, options: EnvironmentStartOptions = {}): Promise<EnvironmentInfo> {
    this.scope.require(key);
    const requestedAt = Date.now();
    const description = await this.describe(key).catch((error: unknown) => {
      throw new EnvironmentNotDispatched(error);
    });
    return this.admission.start(
      key,
      options,
      (admitted) =>
        this.work.run(
          key,
          async () => {
            options = admitted;
            const startedAt = Date.now();
            try {
              await options.assertActive?.();
              options.signal?.throwIfAborted();
            } catch (error) {
              throw new EnvironmentNotDispatched(error);
            }
            const artifacts = await this.deps.projects.get(key.projectId).load();
            const problem = artifacts.problems.find(
              (p) => p.path === '.skaro/config.yaml' && p.message.startsWith('environment:'),
            );
            if (problem) throw new EnvironmentUnavailable(`.skaro/config.yaml: ${problem.message}`);
            const initial = await this.describe(key);
            if (!initial.config)
              throw new EnvironmentUnavailable('The project describes no task environment.');
            if (!existsSync(initial.identity.worktree))
              throw new EnvironmentUnavailable('The task has no checkout of its own.');
            this.touch(key);
            return startEnvironmentServices(key, requestedAt, startedAt, options, {
              registry: this.registry,
              docker: this.docker,
              describe: () => this.describe(key),
              prepare: async () => {
                await this.lifecycle.admit(key);
                await this.serial('allocation', () =>
                  refreshEnvironmentPorts(this.registry, key, this.docker),
                );
              },
              remove: () => this.lifecycle.remove(key, true),
              provenance: (description) => this.lifecycle.provenance.begin(key, description),
              sourceObserved: (source, containers) =>
                this.lifecycle.resources.beginSource(key, source.project, containers),
            });
          },
          true,
        ),
      description,
    );
  }

  /** Stops the task's containers; the copy of the data stays for the next start. */
  stop(key: TaskKey, consumer?: HeldResource, ownerStopped = false): Promise<void> {
    this.scope.require(key);
    return this.work.run(key, () =>
      this.lifecycle.stop(key, undefined, consumer?.lease, ownerStopped),
    );
  }

  /** Removes the environment for good: the task is merged, cancelled or deleted. */
  destroy(key: TaskKey): Promise<string[]> {
    this.scope.require(key);
    return this.work.run(key, () => this.lifecycle.destroy(key));
  }

  /** Finished tasks lose their environments; idle services always stop. */
  enforce(): Promise<void> {
    if (this.closing) return Promise.resolve();
    if (this.maintenance) return this.maintenance;
    const pending = this.lifecycle
      .reconcile(undefined, (key, action) => this.work.run(key, action))
      .finally(() => {
        if (this.maintenance === pending) this.maintenance = undefined;
      });
    this.maintenance = pending;
    return pending;
  }
}
