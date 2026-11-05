import { isAbsolute, relative, resolve, sep } from 'node:path';
import { COMPOSE_PROJECT, hostPath, labelsOf, type DockerContainer } from './containers.ts';

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
 * A recorded Compose project is ownership. A checkout mount, working directory or name prefix
 * alone is not: another application can legitimately use any of those.
 */
export function containerTask(
  container: DockerContainer,
  _worktrees: string,
  names: ReadonlyMap<string, TaskKey>,
): TaskKey | undefined {
  return names.get(labelsOf(container)[COMPOSE_PROJECT] ?? '');
}
