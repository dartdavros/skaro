import { join } from 'node:path';
import {
  environmentVariables,
  type AppDb,
  type EnvironmentConfig,
  type EnvironmentIdentity,
  type TaskKey,
} from '@skaro/core';
import type { ProjectContext } from './projects';
import type { EnvironmentRegistry, EnvironmentRecord } from './task-environment-registry';
import type { EnvironmentDocker } from './task-environment-docker';
import { environmentConfig } from './task-environment-config';
import { describeCompose, type ManagedCompose } from './task-compose';

export interface EnvironmentDescription {
  identity: EnvironmentIdentity;
  config?: EnvironmentConfig;
  variables: Record<string, string>;
  compose?: ManagedCompose;
}

export function recordedEnvironmentIdentity(
  root: string,
  dataDir: string,
  record: EnvironmentRecord,
): EnvironmentIdentity {
  return {
    name: record.name,
    root,
    worktree: record.worktree ?? join(dataDir, 'worktrees', record.projectId, record.taskId),
    ports: record.ports,
  };
}

/** Allocation and shell identity have one owner; configuration changes do not create services. */
export async function describeTaskEnvironment(
  deps: {
    db: Pick<AppDb, 'getProject'>;
    context: ProjectContext;
    dataDir: string;
    registry: EnvironmentRegistry;
    docker: EnvironmentDocker;
  },
  key: TaskKey,
): Promise<EnvironmentDescription> {
  const base = (await deps.context.load()).config.environment;
  const project = deps.db.getProject(key.projectId)?.name ?? '';
  let record = deps.registry.ensure(key, project);
  const config = base ? environmentConfig(deps.registry, key, base) : undefined;
  const missing = (config?.ports ?? []).filter((name) => record.ports[name] === undefined);
  if (missing.length) {
    const ports = await deps.docker.ports(missing.length, deps.registry.takenPorts());
    record = deps.registry.update(key, {
      ports: {
        ...record.ports,
        ...Object.fromEntries(missing.map((name, index) => [name, ports[index]!])),
      },
    })!;
  }
  const identity = recordedEnvironmentIdentity(deps.context.root, deps.dataDir, record);
  const variables = environmentVariables(identity, config);
  const compose = config ? await describeCompose(deps.dataDir, identity, variables) : undefined;
  return { identity, config, variables: compose?.variables ?? variables, compose };
}
