import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppDb, ProjectArtifacts, TaskKey } from '@skaro/core';
import type { ProjectContext, Projects } from './projects';
import type { IntegrationStore } from './integration-store';

const over = (task: { status: string }) => ['done', 'cancelled'].includes(task.status);

async function inventory(root: string): Promise<string[]> {
  const directory = join(root, '.skaro');
  const entries = await readdir(directory);
  // A missing tasks directory cannot prove that all its former tasks were deleted.
  if (!entries.includes('tasks')) throw new Error('Task directory is unavailable');
  const paths: string[] = [];
  for (const kind of ['tasks', 'milestones']) {
    if (!entries.includes(kind)) continue;
    for (const name of await readdir(join(directory, kind)))
      if (name.endsWith('.md')) paths.push(`.skaro/${kind}/${name}`);
  }
  return paths.sort();
}

/** Destructive cleanup needs a complete, fresh read, not ArtifactStore's tolerant UI snapshot. */
export async function environmentArtifacts(
  context: Pick<ProjectContext, 'root' | 'store'>,
): Promise<ProjectArtifacts | undefined> {
  try {
    const before = await inventory(context.root);
    const artifacts = await context.store.load();
    if (artifacts.problems.some((problem) => /^\.skaro\/(tasks|milestones)\//.test(problem.path)))
      return undefined;
    const parsed = [...artifacts.tasks, ...artifacts.milestones].map((item) => item.path).sort();
    const expected = JSON.stringify(before);
    if (
      JSON.stringify(parsed) !== expected ||
      JSON.stringify(await inventory(context.root)) !== expected
    )
      return undefined;
    return artifacts;
  } catch {
    return undefined;
  }
}

/** Review and archived unfinished work retain data; missing metadata must be proven readable. */
export async function taskEnvironmentFinished(
  deps: {
    db: Pick<AppDb, 'getProject'>;
    projects: Pick<Projects, 'get'>;
    integrations: Pick<IntegrationStore, 'find'>;
  },
  key: TaskKey,
): Promise<boolean> {
  // "Remove from the list" unregisters a project; it does not authorize deleting its data.
  if (!deps.db.getProject(key.projectId)) return false;
  try {
    const operation = key.taskId.startsWith('integration-')
      ? deps.integrations.find(key.projectId, key.taskId.slice(12))
      : undefined;
    if (operation?.worker || operation?.executor) return false;
    if (operation && ['applied', 'stale'].includes(operation.state)) return true;
    const artifacts = await environmentArtifacts(deps.projects.get(key.projectId));
    if (!artifacts) return false;
    if (key.taskId.startsWith('integration-')) {
      if (!operation) return true;
      const owner = artifacts.tasks.find((task) => task.id === operation.taskId);
      return !owner || over(owner);
    }
    const task = artifacts.tasks.find((item) => item.id === key.taskId);
    if (task) return over(task);
    // Historical shared checkouts also belong to archived, unfinished stage tasks.
    return artifacts.tasks.filter((item) => item.milestone === key.taskId).every(over);
  } catch {
    return false;
  }
}
