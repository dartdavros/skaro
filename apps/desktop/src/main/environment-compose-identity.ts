import { delimiter, dirname, join, resolve } from 'node:path';
import {
  environmentVariables,
  hostPath,
  labelsOf,
  COMPOSE_WORKDIR,
  COMPOSE_PROJECT,
  type DockerContainer,
  type EnvironmentConfig,
  type EnvironmentIdentity,
} from '@skaro/core';

/** A shared root Compose file is valid only with this task's exact service-owned override. */
export function declaredComposeIdentity(
  container: DockerContainer,
  identity: EnvironmentIdentity,
  config: EnvironmentConfig | undefined,
  dataDir: string,
): boolean {
  if (!config || !/^[a-z0-9][a-z0-9_-]*$/.test(identity.name)) return false;
  const variables = environmentVariables(identity, config);
  if (!variables.COMPOSE_FILE) return false;
  const files = variables.COMPOSE_FILE.split(variables.COMPOSE_PATH_SEPARATOR ?? delimiter)
    .filter(Boolean)
    .map((file) => resolve(identity.worktree, file));
  if (!files.length) return false;
  files.push(join(dataDir, 'environments', identity.name, 'ports.yaml'));
  const labels = labelsOf(container);
  if (labels[COMPOSE_PROJECT] !== identity.name) return false;
  const directory = labels[COMPOSE_WORKDIR];
  const actual = labels['com.docker.compose.project.config_files']
    ?.split(',')
    .map((file) => resolve(hostPath(file)));
  return (
    !!directory &&
    resolve(hostPath(directory)) === dirname(files[0]!) &&
    !!actual &&
    actual.length === files.length &&
    actual.every((file, i) => file === resolve(files[i]!))
  );
}
