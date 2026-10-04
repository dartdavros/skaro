import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  environmentName,
  environmentVariables,
  expand,
  ownProjects,
  runShell,
  waitReady,
  type AppDb,
  type DockerContainer,
  type EnvironmentConfig,
  type EnvironmentIdentity,
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
import { keepWithinLimit } from './task-environment-limit';

/** A build and the first copy of the data take minutes; a hung command must still end. */
const COMMAND_TIMEOUT_MS = 30 * 60_000;

export interface EnvironmentDeps {
  db: Pick<AppDb, 'getSetting' | 'setSetting' | 'getProject'>;
  /** App data folder: task checkouts live in worktrees/<project>/<task>. */
  dataDir: string;
  projects: Projects;
  /** Tasks whose agent works now. */
  busy: () => TaskKey[];
  /** How many task environments may run at once: "Одновременных запусков". */
  limit: () => number;
  /** The task is merged, cancelled or gone: its environment has no reason to exist. */
  finished: (key: TaskKey) => Promise<boolean>;
  docker?: EnvironmentDocker;
}

export interface EnvironmentInfo {
  name: string;
  urls: Record<string, string>;
}

/** The environment cannot be started for a reason the agent should report, not retry. */
export class EnvironmentUnavailable extends Error {}

/**
 * Task environments (task-environments.md): a disposable copy of the project's services per task.
 * Skaro names it, gives it ports, starts it on request, keeps the running ones within the limit
 * and removes it with the task.
 */
export class TaskEnvironments {
  private readonly deps: EnvironmentDeps;
  private readonly registry: EnvironmentRegistry;
  private readonly docker: EnvironmentDocker;
  /** Docker work runs one at a time: parallel builds and starts are what made tasks hang. */
  private work: Promise<unknown> = Promise.resolve();
  private allocation: Promise<unknown> = Promise.resolve();

  constructor(deps: EnvironmentDeps) {
    this.deps = deps;
    this.registry = new EnvironmentRegistry(deps.db);
    this.docker = deps.docker ?? systemDocker;
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
  describe(key: TaskKey): Promise<{
    identity: EnvironmentIdentity;
    config: EnvironmentConfig | undefined;
    variables: Record<string, string>;
  }> {
    return this.serial('allocation', async () => {
      const context = this.deps.projects.get(key.projectId);
      const config = (await context.load()).config.environment;
      const project = this.deps.db.getProject(key.projectId)?.name ?? '';
      let record = this.registry.ensure(key, project);
      const missing = (config?.ports ?? []).filter((name) => record.ports[name] === undefined);
      if (missing.length) {
        const ports = await this.docker.ports(missing.length, this.registry.takenPorts());
        const added = Object.fromEntries(missing.map((name, i) => [name, ports[i]!]));
        record = this.registry.update(key, { ports: { ...record.ports, ...added } })!;
      }
      const identity = {
        name: record.name,
        root: context.root,
        worktree: join(this.worktrees(), key.projectId, key.taskId),
        ports: record.ports,
      };
      return { identity, config, variables: environmentVariables(identity, config) };
    });
  }

  /** Variables for the agent's shell: its own `docker compose` addresses the same environment. */
  async sessionEnv(key: TaskKey): Promise<Record<string, string>> {
    return (await this.describe(key)).variables;
  }

  /** The agent's turn began: the task counts as recently used. */
  touch(key: TaskKey): void {
    this.registry.update(key, { usedAt: Date.now() });
  }

  /** Creates the copy on first use, starts the services and waits until they are ready. */
  start(key: TaskKey): Promise<EnvironmentInfo> {
    return this.serial('work', async () => {
      const artifacts = await this.deps.projects.get(key.projectId).load();
      const problem = artifacts.problems.find(
        (p) => p.path === '.skaro/config.yaml' && p.message.startsWith('environment:'),
      );
      if (problem) throw new EnvironmentUnavailable(`.skaro/config.yaml: ${problem.message}`);
      const { identity, config, variables } = await this.describe(key);
      if (!config) throw new EnvironmentUnavailable('The project describes no task environment.');
      if (!existsSync(identity.worktree))
        throw new EnvironmentUnavailable('The task has no checkout of its own.');
      this.touch(key);
      await this.reconcile(key);
      const run = (label: string, command: string) =>
        runShell(expand(command, identity), {
          cwd: identity.worktree,
          env: variables,
          label,
          timeoutMs: COMMAND_TIMEOUT_MS,
        });
      if (config.create) {
        const kept = this.registry.find(key)?.created && (await this.docker.hasData(identity.name));
        if (!kept) {
          // A failed or hand-removed copy leaves no half of itself behind the new one.
          await this.remove(key, 'named');
          await run('create', config.create);
          this.registry.update(key, { created: true });
        }
      }
      await run('start', config.start);
      if (config.ready) await waitReady(expand(config.ready, identity));
      const urls = Object.entries(config.urls).map(([name, url]) => [name, expand(url, identity)]);
      return { name: identity.name, urls: Object.fromEntries(urls) as Record<string, string> };
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
      const failures = await this.remove(key);
      if (!failures.length) this.registry.remove(key);
      return failures;
    });
  }

  /** Finished tasks lose their environments; the running ones are kept within the limit. */
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
    const stale = await keepWithinLimit({
      containers: all,
      worktrees: this.worktrees(),
      names: this.names(),
      records: this.registry.all(),
      busy,
      ...(starting ? { starting } : {}),
      limit: this.deps.limit(),
      finished: this.deps.finished,
      stop: (containers) => this.docker.stop(containers),
    });
    for (const key of stale) {
      const failures = await this.remove(key).catch((error: unknown) => [String(error)]);
      if (!failures.length) this.registry.remove(key);
    }
  }
}
