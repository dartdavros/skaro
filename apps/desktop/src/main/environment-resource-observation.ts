import { COMPOSE_PROJECT, labelsOf, type DockerContainer } from '@skaro/core';

/** Missing Docker evidence is different from a successful observation of no objects. */
export function observedEnvironmentObjectIds(
  containers: DockerContainer[] | undefined,
  composeProject: string,
  previous: readonly string[] = [],
): string[] {
  return containers === undefined
    ? [...previous]
    : containers
        .filter((container) => labelsOf(container)[COMPOSE_PROJECT] === composeProject)
        .map((container) => container.Id);
}
