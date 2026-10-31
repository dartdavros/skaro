import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { taskBranch, indexTasks, pendingDependencies } from '@skaro/core';
import { Timeline } from '@skaro/timeline';
import { findTask, key } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { updateSubject } from './task-subject';
import { prepareTaskWorktree } from './task-worktree';
import { serializeTaskMutation } from './project-task-mutations';

/**
 * A new run of a task (or of a stage acceptance): its checkout, its record and its feed. No
 * agent works yet: a turn starts it, and the merge of a stage needs the feed alone.
 */
export async function createTaskRun(
  ctx: TaskRunEngine,
  projectId: string,
  taskId: string,
): Promise<ActiveRun> {
  return serializeTaskMutation(ctx.project(projectId), () =>
    createLockedTaskRun(ctx, projectId, taskId),
  );
}

async function createLockedTaskRun(
  ctx: TaskRunEngine,
  projectId: string,
  taskId: string,
): Promise<ActiveRun> {
  const context = ctx.project(projectId);
  const artifacts = await context.load();
  const task = findTask(artifacts, taskId);
  const settings = ctx.views.settings(projectId, task, artifacts);

  let worktree: string | undefined;
  let branch: string | undefined;
  if (!artifacts.tasks.some((item) => item.id === taskId))
    throw new Error('Milestones have no agent sessions. Open a task or the project chat.');
  const pending = pendingDependencies(task, indexTasks(artifacts.tasks));
  if (!task.unblocked && pending.length)
    throw new Error(`${task.id}: dependencies are not ready: ${pending.join(', ')}`);
  if (
    settings.isolation !== 'worktree' &&
    artifacts.tasks.some((item) => task.dependsOn.includes(item.id) && item.status === 'review')
  )
    throw new Error(
      'An in-place task must wait until its dependencies are merged. Use worktree isolation to integrate review dependencies.',
    );
  if (settings.isolation === 'worktree') {
    branch = task.branch ?? taskBranch(artifacts.config, task);
    worktree = await prepareTaskWorktree({
      git: context.git,
      dataDir: ctx.deps.dataDir,
      projectId,
      taskId,
      branch,
      base: artifacts.config.baseBranch,
    });
  }
  await updateSubject(context, taskId, {
    status: 'in_progress',
    ...(branch ? { branch } : {}),
  });
  context.invalidate();

  const logPath = join(
    'runs',
    projectId,
    taskId,
    `${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`,
  );
  const adapter = ctx.deps.agents.adapter(settings.agent);
  const run = ctx.deps.db.createRun({
    projectId,
    taskId,
    agent: settings.agent,
    ...(settings.model ? { model: settings.model } : {}),
    ...(worktree ? { worktree } : {}),
    ...(branch ? { branch } : {}),
    logPath,
    adapterVersion: adapter.adapterVersion,
  });
  const active = new ActiveRun(projectId, taskId, run, new Timeline());
  ctx.active.set(key(projectId, taskId), active);
  ctx.continuation.execution(active).start();
  return active;
}
