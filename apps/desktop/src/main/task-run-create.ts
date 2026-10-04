import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { taskBranch } from '@skaro/core';
import { Timeline } from '@skaro/timeline';
import { findTask, key } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { stageOf } from './task-stage';
import { updateSubject } from './task-subject';
import { prepareTaskWorktree } from './task-worktree';

/**
 * A new run of a task (or of a stage acceptance): its checkout, its record and its feed. No
 * agent works yet: a turn starts it, and the merge of a stage needs the feed alone.
 */
export async function createTaskRun(
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
  // A task of a milestone works in the milestone's checkout; the branch is not the task's.
  const stage = settings.isolation === 'worktree' ? stageOf(task, artifacts) : undefined;
  if (stage) {
    ({ worktree, branch } = await ctx.stages.checkout(projectId, stage, context));
  } else if (settings.isolation === 'worktree') {
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
    ...(branch && !stage ? { branch } : {}),
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
  return active;
}
