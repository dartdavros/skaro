import {
  allocatePorts,
  COMPOSE_PROJECT,
  containerTask,
  environmentHasData,
  inspectContainers,
  labelsOf,
  removeEnvironment,
  stopContainers,
  type DockerContainer,
  type TaskKey,
} from '@skaro/core';

/** Docker and host operations of task environments; tests replace them. */
export interface EnvironmentDocker {
  inspect: () => Promise<DockerContainer[]>;
  stop: (containers: DockerContainer[]) => Promise<void>;
  remove: (containers: DockerContainer[], projects: string[]) => Promise<string[]>;
  hasData: (name: string) => Promise<boolean>;
  ports: (count: number, taken: ReadonlySet<number>) => Promise<number[]>;
}

export const systemDocker: EnvironmentDocker = {
  inspect: inspectContainers,
  stop: stopContainers,
  remove: removeEnvironment,
  hasData: environmentHasData,
  ports: allocatePorts,
};

export function sameTask(a: TaskKey | undefined, b: TaskKey): boolean {
  return a?.projectId === b.projectId && a.taskId === b.taskId;
}

/** Every container of the task: its environment and whatever was started from its checkout. */
export function taskContainers(
  all: DockerContainer[],
  key: TaskKey,
  worktrees: string,
  names: ReadonlyMap<string, TaskKey>,
): DockerContainer[] {
  return all.filter((container) => sameTask(containerTask(container, worktrees, names), key));
}

/** Only what carries the environment's own name: a retried copy must not touch anything else. */
export function namedContainers(all: DockerContainer[], name: string): DockerContainer[] {
  return all.filter((container) => labelsOf(container)[COMPOSE_PROJECT] === name);
}
