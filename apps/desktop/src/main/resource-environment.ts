import type { TaskKey } from '@skaro/core';
import type { EnvironmentDeps } from './task-environments';
import type { EnvironmentStartOptions } from './task-environment-start';
import { resourcesFor, resourceExecution, type HeldResource } from './resource-execution';
import { environmentResourceCost } from './resource-environment-cost';
import type { EnvironmentDescription } from './task-environment-description';
import { EnvironmentNotDispatched } from './environment-dispatch-error';

/** Runtime capacity outlives a build or model turn and is freed only by verified Docker teardown. */
export class EnvironmentAdmission {
  private readonly deps: EnvironmentDeps;
  private readonly held = new Map<string, HeldResource>();
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(deps: EnvironmentDeps) {
    this.deps = deps;
  }
  async start<T>(
    key: TaskKey,
    options: EnvironmentStartOptions,
    action: (options: EnvironmentStartOptions) => Promise<T>,
    description: EnvironmentDescription,
  ): Promise<T> {
    const resources = resourcesFor(this.deps.db);
    if (!resources) return action(options);
    const owner = `environment:${key.taskId}`;
    const identity = JSON.stringify(key);
    const inherited = resourceExecution.getStore();
    const execute = async () => {
      const scope = resourceExecution.getStore()!;
      const newlyReserved = !this.held.has(identity);
      let entered = false;
      try {
        await scope.requireCurrent();
        const cost = await environmentResourceCost(
          this.deps.db,
          this.deps.dataDir,
          description,
          key.projectId,
        );
        if (!this.held.has(identity))
          this.held.set(
            identity,
            await resources.acquire(
              'environment',
              { ...scope, ownerId: owner },
              { checkpoint: owner, cost, wait: options.waitForResources },
            ),
          );
        const signal = AbortSignal.any([scope.signal, ...(options.signal ? [options.signal] : [])]);
        return await resources.phase('build', () => {
          entered = true;
          return action({ ...options, signal });
        });
      } catch (error) {
        if (!entered && newlyReserved) {
          this.held.get(identity)?.release('environment_start_cancelled_before_dispatch');
          this.held.delete(identity);
        }
        if (!entered) throw new EnvironmentNotDispatched(error);
        throw error;
      }
    };
    const before = this.pending.get(identity) ?? Promise.resolve();
    const next = before
      .catch(() => undefined)
      .then(() =>
        inherited
          ? resourceExecution.run(inherited, execute)
          : resources.scope(key.projectId, owner, execute, {
              ...(options.signal ? { signal: options.signal } : {}),
              requireCurrent: options.assertActive,
            }),
      );
    this.pending.set(identity, next);
    try {
      return await next;
    } finally {
      if (this.pending.get(identity) === next) this.pending.delete(identity);
    }
  }
  stopped(key: TaskKey): void {
    resourcesFor(this.deps.db)?.releaseOwner(
      key.projectId,
      `environment:${key.taskId}`,
      'owned_containers_confirmed_stopped',
    );
    this.held.delete(JSON.stringify(key));
  }
}
