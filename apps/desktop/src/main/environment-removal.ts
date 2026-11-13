import {
  COMPOSE_PROJECT,
  ResourceCleanupBlocked,
  labelsOf,
  type AppDb,
  type DockerContainer,
  type ResourceRecord,
  type DockerRemovalExecutor,
  type DockerRemovalAuthorization,
} from '@skaro/core';
import type { EnvironmentDocker } from './task-environment-docker';

/** Keep exclusion through physical verification, release/renewal and caller completion metadata. */
export async function disposeEnvironment(
  options: {
    db: Pick<AppDb, 'resources'>;
    resource: ResourceRecord;
    docker: EnvironmentDocker;
    containers: DockerContainer[];
    projects: string[];
    step: DockerRemovalExecutor;
    authorization: DockerRemovalAuthorization;
    inspect: () => Promise<DockerContainer[]>;
    completed: (failures: string[]) => void;
  },
  preparation = false,
): Promise<string[]> {
  const { db, resource } = options;
  try {
    return await db.resources.cleanup.run(
      resource,
      `environment.remove:${resource.id}:${resource.generation}`,
      async () => {
        let failures: string[];
        try {
          failures = await options.docker.remove(
            options.containers,
            options.projects,
            options.step,
            options.authorization,
          );
          if (
            !failures.length &&
            (await options.inspect()).some(
              (container) =>
                labelsOf(container)[COMPOSE_PROJECT] === resource.identity.composeProject,
            )
          )
            failures.push('Environment still has containers after removal.');
        } catch (error) {
          failures = [error instanceof ResourceCleanupBlocked ? error.reason : String(error)];
        }
        if (!failures.length) db.resources.cleanup.reconciled(resource.id);
        options.completed(failures);
        return failures;
      },
      preparation,
    );
  } catch (error) {
    const failures = [error instanceof ResourceCleanupBlocked ? error.reason : String(error)];
    options.completed(failures);
    return failures;
  }
}
