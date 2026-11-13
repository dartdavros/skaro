import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  git,
  assertWorkflowGraph,
  indexTasks,
  isBlocked,
  pendingDependencies,
  type AppDb,
  type ProjectArtifacts,
} from '@skaro/core';
import type { ProjectContext } from './projects';
import { CompletionStore, criteriaRevision } from './completion-store';
import { memoryVersion, requireMemoryPath } from './project-memory-sources';
import { taskEnvironmentVersion } from './task-environment-version';

export interface TaskInputSnapshot {
  version: string;
  projectId: string;
  taskId: string;
  requirements: string;
  dependencies: { taskId: string; status: string; head: string; criteria: string }[];
  environment: string;
  checks: string;
  workflow: string;
  authority: string;
}

export async function taskInputSnapshot(
  db: AppDb,
  context: ProjectContext,
  artifacts: ProjectArtifacts,
  taskId: string,
): Promise<TaskInputSnapshot> {
  if (artifacts.problems.length)
    throw new Error('Project artifacts must be valid before task preflight');
  const task = artifacts.tasks.find((t) => t.id === taskId);
  if (!task || task.archived) throw new Error('Task preflight owner is missing or archived');
  assertWorkflowGraph(artifacts.tasks, artifacts.config.workflow, taskId);
  const index = indexTasks(artifacts.tasks);
  if (isBlocked(task, index) || (!task.unblocked && pendingDependencies(task, index).length))
    throw new Error(
      `${taskId}: code dependencies are not ready; review does not authorize an ordinary start (D-45)`,
    );
  const store = new CompletionStore(db, context.id);
  const dependencies: TaskInputSnapshot['dependencies'] = [];
  for (const id of task.dependsOn) {
    const dependency = index.get(id);
    const accepted = store.result(id);
    if (
      !dependency ||
      !accepted ||
      accepted.criteria !== criteriaRevision(dependency) ||
      !['review', 'done'].includes(dependency.status)
    )
      throw new Error(`${id}: no current accepted SHA; status alone is insufficient`);
    await git(context.root, ['cat-file', '-e', `${accepted.head}^{commit}`]);
    dependencies.push({
      taskId: id,
      status: dependency.status,
      head: accepted.head,
      criteria: accepted.criteria,
    });
  }
  const documents = [
    artifacts.brief,
    artifacts.architecture,
    ...artifacts.adrs.filter((d) => d.status === 'accepted'),
    ...artifacts.specs.filter((s) => s.id === task.spec),
  ].filter((d) => d !== undefined);
  const versions = [];
  for (const document of documents)
    versions.push([
      document.path,
      memoryVersion(await readFile(await requireMemoryPath(context.root, document.path), 'utf8')),
    ]);
  const snapshot = {
    schema: 1,
    projectId: context.id,
    taskId,
    requirements: memoryVersion([task.title, task.body, task.spec, versions]),
    dependencies,
    environment: await taskEnvironmentVersion(context.root, artifacts.config.environment),
    checks: memoryVersion(artifacts.config.checks),
    workflow: memoryVersion(artifacts.config.workflow?.[taskId] ?? []),
    authority: memoryVersion([
      task.unblocked,
      artifacts.config.permissionMode,
      artifacts.config.agentInstructions,
      artifacts.config.globalInstructions,
    ]),
  };
  return { ...snapshot, version: memoryVersion(snapshot) };
}

export async function verifyPrerequisites(
  artifacts: ProjectArtifacts,
  taskId: string,
  cwd: string,
  phase: 'prerequisite' | 'result' = 'prerequisite',
): Promise<void> {
  for (const input of artifacts.config.workflow?.[taskId] ?? []) {
    if (input.phase !== phase) continue;
    if (input.kind === 'artifact') {
      const path = await requireMemoryPath(cwd, input.path!);
      if (
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex') !== input.sha256
      )
        throw new Error(`${taskId}: artifact prerequisite ${input.id} has a different SHA256`);
    } else {
      const response = await fetch(input.url!, {
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      await response.body?.cancel();
      if (!response.ok)
        throw new Error(
          `${taskId}: service prerequisite ${input.id} is not ready (${response.status})`,
        );
    }
  }
}
