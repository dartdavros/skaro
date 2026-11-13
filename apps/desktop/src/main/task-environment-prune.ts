import { COMPOSE_PROJECT, labelsOf, type DockerContainer, type TaskKey } from '@skaro/core';
import { backgroundWork } from './background-work';
import type { EnvironmentDocker } from './task-environment-docker';
import type { EnvironmentRegistry, RetiredEnvironment } from './task-environment-registry';

/** Only recorded, retired Skaro owners authorize collecting leftover named resources. */
export class EnvironmentPruning {
  private last = 0;
  async run(
    docker: EnvironmentDocker,
    registry: EnvironmentRegistry,
    finished: (key: TaskKey) => Promise<boolean>,
    busy: () => TaskKey[],
    projectScope?: string,
    remove?: (owner: RetiredEnvironment, containers: DockerContainer[]) => Promise<string[]>,
    inspect: () => Promise<DockerContainer[]> = () => docker.inspect(),
  ) {
    if (Date.now() - this.last < 60 * 60_000) return;
    this.last = Date.now();
    for (const owner of registry.retired()) {
      const inUse = () =>
        busy().some((key) => key.projectId === owner.projectId && key.taskId === owner.taskId);
      if (projectScope && owner.projectId !== projectScope) continue;
      if (inUse()) continue;
      if (registry.all().some((record) => record.name === owner.name)) continue;
      if (!(await finished(owner))) continue;
      const containers = await inspect();
      if (containers.some((container) => labelsOf(container)[COMPOSE_PROJECT] === owner.name))
        continue;
      if (inUse() || registry.all().some((record) => record.name === owner.name)) continue;
      const job = backgroundWork.start('docker.prune');
      // Every production call passes the ledger guard; no unguarded fallback is permitted.
      try {
        const failures = remove
          ? await remove(owner, containers)
          : ['Resource ownership guard is unavailable.'];
        if (failures.length) backgroundWork.fail(job, failures.join('; '));
        else backgroundWork.finish(job);
      } catch (error) {
        backgroundWork.fail(job, error);
        throw error;
      }
    }
  }
}
