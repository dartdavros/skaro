import { existsSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import {
  environmentName,
  containerTask,
  ownProjects,
  type AppDb,
  type DockerContainer,
  type EnvironmentConfig,
  type TaskKey,
} from '@skaro/core';
import type { Projects } from './projects';
import { EnvironmentRegistry } from './task-environment-registry';
import {
  namedContainers,
  systemDocker,
  taskContainers,
  type EnvironmentDocker,
} from './task-environment-docker';
import { reconcileTaskEnvironments } from './task-environment-limit';
import type { ConfigureEnvironmentArgs } from '@skaro/mcp-server';
import { configureEnvironment } from './task-environment-config';
import {
  describeTaskEnvironment,
  type EnvironmentDescription,
} from './task-environment-description';
import { removeCompose } from './task-compose';
import { refreshEnvironmentPorts } from './task-environment-ports';
import { startEnvironmentServices, type EnvironmentStartOptions } from './task-environment-start';
import { environmentLink, environmentLinkAddress } from './task-environment-link';
import { backgroundWork, environmentJob, freedResult } from './background-work';

export interface EnvironmentDeps {
  db: Pick<AppDb, 'getSetting' | 'setSetting' | 'getProject'>;
  /** App data folder: task checkouts live in worktrees/<project>/<task>. */
  dataDir: string;
  projects: Projects;
  /** Tasks whose agent works now. */
  busy: () => TaskKey[];
  /** The task is merged, cancelled or gone: its environment has no reason to exist. */
  finished: (key: TaskKey) => Promise<boolean>;
  docker?: EnvironmentDocker;
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
  private pruned = 0;
  /** Docker work runs one at a time: parallel builds and starts are what made tasks hang. */
  private work: Promise<unknown> = Promise.resolve();
  private allocation: Promise<unknown> = Promise.resolve();

  constructor(deps: EnvironmentDeps) {
    this.deps = deps;
    this.registry = new EnvironmentRegistry(deps.db);
    this.docker = deps.docker ?? systemDocker;
  }

  /** Shutdown must drain scheduled cleanup before the application's database is closed. */
  async idle(): Promise<void> {
    await Promise.allSettled([this.work, this.allocation]);
  }

  /** Once agent processes have stopped, no task services may outlive the application. */
  close(): Promise<void> {
    return this.serial('work', async () => {
      const all = await this.docker.inspect();
      const owned = all.filter(
        (container) => !!containerTask(container, this.worktrees(), this.names()),
      );
      await this.docker.stop(owned);
    });
  }

  private worktrees(): string {
    return join(this.deps.dataDir, 'worktrees');
  }

  private names(): Map<string, TaskKey> {
    return new Map(this.registry.all().map((r) => [r.name, r]));
  }

  private serial<T>(queue: 'work' | 'allocation', action: () => Promise<T>): Promise<T> {
    const next = this[queue].catch(() => undefined).then(action);
    this[queue] = next;
    return next;
  }

  /** Name and ports of the task's environment, promised on first use and kept until it is removed. */
  describe(key: TaskKey): Promise<EnvironmentDescription> {
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
    this.registry.update(key, { usedAt: Date.now() });
  }

  /** Only Skaro's integration executor can bind an environment to its private candidate. */
  bindIntegration(key: TaskKey, worktree: string): void {
    const suffix = relative(join(this.deps.dataDir, 'integrations', key.projectId), worktree);
    if (!key.taskId.startsWith('integration-') || suffix.startsWith('..') || isAbsolute(suffix))
      throw new Error('Integration environment must belong to its project data directory.');
    this.registry.ensure(key, this.deps.db.getProject(key.projectId)?.name ?? '');
    this.registry.update(key, { worktree });
  }

  /** Resolve only this environment's allocated host addresses; other links stay ordinary links. */
  link(key: TaskKey, url: string): string | undefined {
    const record = this.registry.find(key);
    return record && environmentLink(record, url);
  }

  linkAddress(key: TaskKey, url: string, portName: string): string {
    const port = this.registry.find(key)?.ports[portName];
    if (!port) throw new EnvironmentUnavailable('The environment no longer exposes this address.');
    return environmentLinkAddress(url, port);
  }

  /** Read/save configuration in the same queue as starts; no services run during this call. */
  configure(key: TaskKey, args: ConfigureEnvironmentArgs): Promise<EnvironmentConfig> {
    return this.serial('work', async () => {
      const { identity, config } = await this.describe(key);
      if (!config)
        throw new EnvironmentUnavailable('The project describes no valid task environment.');
      if (!existsSync(identity.worktree))
        throw new EnvironmentUnavailable('The task has no checkout of its own.');
      configureEnvironment(this.registry, key, config, args);
      return (await this.describe(key)).config!;
    });
  }

  /** Creates the copy on first use, starts the services and waits until they are ready. */
  start(key: TaskKey, options: EnvironmentStartOptions = {}): Promise<EnvironmentInfo> {
    const requestedAt = Date.now();
    return this.serial('work', async () => {
      const startedAt = Date.now();
      options.signal?.throwIfAborted();
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
          await this.reconcile(key);
          await this.serial('allocation', () =>
            refreshEnvironmentPorts(this.registry, key, this.docker),
          );
        },
        remove: () => this.remove(key, 'named'),
      });
    });
  }

  /** Stops the task's containers; the copy of the data stays for the next start. */
  stop(key: TaskKey): Promise<void> {
    return this.serial('work', async () => {
      const all = await this.docker.inspect();
      await this.docker.stop(taskContainers(all, key, this.worktrees(), this.names()));
    });
  }

  /** Removes the environment for good: the task is merged, cancelled or deleted. */
  destroy(key: TaskKey): Promise<string[]> {
    return this.serial('work', async () => {
      if (
        this.deps
          .busy()
          .some((owner) => owner.projectId === key.projectId && owner.taskId === key.taskId)
      )
        return ['The environment is still in use; cleanup will retry after its owner stops.'];
      const failures = await this.remove(key);
      if (!failures.length) {
        const name = this.registry.find(key)?.name;
        if (name) await removeCompose(this.deps.dataDir, name);
        this.registry.remove(key);
      }
      return failures;
    });
  }

  /** Finished tasks lose their environments; idle services always stop. */
  enforce(): Promise<void> {
    return this.serial('work', () => this.reconcile());
  }

  private async remove(key: TaskKey, scope: 'task' | 'named' = 'task'): Promise<string[]> {
    const all = await this.docker.inspect();
    const project = this.deps.db.getProject(key.projectId)?.name ?? '';
    const name = this.registry.find(key)?.name ?? environmentName(project, key.taskId);
    const owned =
      scope === 'named'
        ? namedContainers(all, name)
        : taskContainers(all, key, this.worktrees(), this.names());
    this.registry.update(key, { created: false });
    return this.docker.remove(owned, ownProjects(name, owned, all));
  }

  private async reconcile(starting?: TaskKey): Promise<void> {
    let all: DockerContainer[];
    try {
      all = await this.docker.inspect();
    } catch {
      return; // No Docker, nothing to limit.
    }
    const busy = [...this.deps.busy(), ...(starting ? [starting] : [])];
    const stale = await reconcileTaskEnvironments({
      containers: all,
      worktrees: this.worktrees(),
      names: this.names(),
      records: this.registry.all(),
      busy,
      ...(starting ? { starting } : {}),
      finished: this.deps.finished,
      stop: (containers) => this.docker.stop(containers),
    });
    for (const key of stale) {
      if (
        this.deps
          .busy()
          .some((owner) => owner.projectId === key.projectId && owner.taskId === key.taskId)
      )
        continue;
      const job = backgroundWork.start(...environmentJob(this.deps.db, key));
      const failures = await this.remove(key).catch((error: unknown) => [String(error)]);
      if (!failures.length) {
        const name = this.registry.find(key)?.name;
        if (name) await removeCompose(this.deps.dataDir, name);
        this.registry.remove(key);
        backgroundWork.finish(job);
      } else backgroundWork.fail(job, failures.join('; '));
    }
    // Removed and recreated containers leave anonymous volumes, untagged images and cache behind:
    // they go with every removal and at least hourly, not on each frequent limit pass.
    if (!stale.length && Date.now() - this.pruned < 60 * 60_000) return;
    this.pruned = Date.now();
    const job = backgroundWork.start('docker.prune');
    const { failures, reclaimed } = await this.docker.prune();
    if (failures.length) {
      console.error('Docker cleanup:', failures.join('; '));
      backgroundWork.fail(job, failures.join('; '));
    } else backgroundWork.finish(job, freedResult(reclaimed));
  }
}
