import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  COMPOSE_PROJECT,
  hostFolders,
  hostPath,
  labelsOf,
  type DockerContainer,
} from './containers.ts';

export interface TaskKey {
  projectId: string;
  taskId: string;
}

/** The task a folder under `<data>/worktrees/<project>/<task>` belongs to. */
export function taskOfFolder(worktrees: string, folder: string): TaskKey | undefined {
  const path = relative(resolve(hostPath(worktrees)), resolve(hostPath(folder)));
  if (!path || isAbsolute(path) || path.startsWith('..')) return undefined;
  const [projectId, taskId] = path.split(sep);
  return projectId && taskId ? { projectId, taskId } : undefined;
}

/**
 * The task a container belongs to: by the environment name Skaro gave its compose project, else
 * by the task checkout it was started from or mounts. Containers of the main
 * working copy and of other software belong to no task.
 */
export function containerTask(
  container: DockerContainer,
  worktrees: string,
  names: ReadonlyMap<string, TaskKey>,
): TaskKey | undefined {
  const named = names.get(labelsOf(container)[COMPOSE_PROJECT] ?? '');
  if (named) return named;
  for (const folder of hostFolders(container)) {
    const task = taskOfFolder(worktrees, folder);
    if (task) return task;
  }
  return undefined;
}
