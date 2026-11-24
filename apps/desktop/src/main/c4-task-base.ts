import { git, type AppDb, type ProjectArtifacts, type ProjectConfig } from '@skaro/core';
import { criteriaRevision } from './completion-store';
import type { TaskInputSnapshot } from './task-preflight-inputs';

/** An in-place task can start from an accepted dependency ahead of the configured base. */
export async function taskC4Base(
  db: Pick<AppDb, 'getSetting'>,
  artifacts: Pick<ProjectArtifacts, 'tasks'> & { config: Pick<ProjectConfig, 'baseBranch'> },
  owner: { projectId: string; taskId: string; runId?: string; checkout: string; inPlace: boolean },
): Promise<string> {
  const { projectId, taskId, runId, checkout, inPlace } = owner;
  let base = (
    await git(checkout, ['rev-parse', '--verify', `${artifacts.config.baseBranch}^{commit}`])
  ).stdout.trim();
  if (!inPlace || !runId) return base;
  const inputs = db.getSetting<TaskInputSnapshot | null>(`coordination.inputs.${runId}`, null);
  if (inputs?.projectId !== projectId || inputs.taskId !== taskId || !inputs.dependencies.length)
    return base;
  const task = artifacts.tasks.find((item) => item.id === taskId);
  if (!task) return base;
  const head = (await git(checkout, ['rev-parse', '--verify', 'HEAD^{commit}'])).stdout.trim();
  const ancestor = async (from: string, to: string) =>
    (await git(checkout, ['merge-base', '--is-ancestor', from, to], { allowFail: true })).code ===
    0;
  for (const input of inputs.dependencies) {
    if (
      input.status !== 'done' ||
      !task.dependsOn.includes(input.taskId) ||
      input.head === base ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.head)
    )
      continue;
    const dependency = artifacts.tasks.find((item) => item.id === input.taskId);
    if (dependency?.status !== 'done' || criteriaRevision(dependency) !== input.criteria) continue;
    if ((await ancestor(base, input.head)) && (await ancestor(input.head, head))) base = input.head;
  }
  return base;
}
