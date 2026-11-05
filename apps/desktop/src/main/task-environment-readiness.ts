import { COMPOSE_PROJECT, labelsOf, type DockerContainer } from '@skaro/core';

/** Inspect real long-lived services after the launch command: --wait can miss a later crash. */
export function environmentReadinessProblems(
  containers: DockerContainer[],
  name: string,
): string[] {
  const own = containers.filter(
    (container) =>
      labelsOf(container)[COMPOSE_PROJECT] === name &&
      labelsOf(container)['com.docker.compose.oneoff']?.toLowerCase() !== 'true',
  );
  const problems = own.flatMap((container) => {
    const state = container.State;
    const service = labelsOf(container)['com.docker.compose.service'] ?? container.Name;
    if (!state) return [`${service}: container state is unavailable`];
    if (state.Restarting || state.Status === 'dead')
      return [`${service}: ${state.Status ?? 'restarting'}`];
    if (!state.Running && state.ExitCode !== 0)
      return [`${service}: exited with code ${state.ExitCode ?? 'unknown'}`];
    if (state.Running && state.Health && state.Health.Status !== 'healthy')
      return [`${service}: health=${state.Health.Status}`];
    return [];
  });
  if (!own.some((container) => container.State?.Running))
    problems.push('No running Compose services');
  return problems;
}
