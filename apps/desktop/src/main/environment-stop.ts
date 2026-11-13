import {
  COMPOSE_PROJECT,
  labelsOf,
  ResourceCleanupBlocked,
  type AppDb,
  type DockerContainer,
  type ResourceLease,
  type ResourceRecord,
} from '@skaro/core';
import type { ResourceLifecycle } from './resource-lifecycle';

/** Stop-only maintenance: own review lease stays held until every exact service is confirmed stopped. */
export async function stopOwnedEnvironment(options: {
  db: Pick<AppDb, 'resources'>;
  resource: ResourceRecord;
  journal: ResourceLifecycle;
  inspect: () => Promise<DockerContainer[]>;
  guard: () => Promise<void>;
  execute: () => Promise<void>;
  completed: (failures?: string[]) => void;
  teardown?: ResourceLease;
}): Promise<void> {
  const { db, resource } = options;
  const stopped = async () =>
    !(await options.inspect()).some(
      (container) =>
        labelsOf(container)[COMPOSE_PROJECT] === resource.identity.composeProject &&
        container.State?.Running,
    );
  try {
    await db.resources.cleanup.runStop(
      resource,
      `environment.stop:${resource.id}:${resource.generation}`,
      async () => {
        await options.journal.run(resource, 'stop', {
          guard: options.guard,
          verify: stopped,
          execute: async () => {
            db.resources.cleanup.effect(resource.id, true, 'stop');
            await options.execute();
            db.resources.cleanup.externalSettled(resource.id);
          },
        });
        await options.guard();
        if (!(await stopped()))
          throw new Error('Environment still has running containers after stopping.');
        db.resources.cleanup.reconciled(resource.id);
        options.completed();
      },
      options.teardown,
    );
  } catch (error) {
    options.completed([error instanceof ResourceCleanupBlocked ? error.reason : String(error)]);
    throw error;
  }
}
