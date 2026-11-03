import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { taskBranch, indexTasks, pendingDependencies, startBlocker } from '@skaro/core';
import { Timeline } from '@skaro/timeline';
import { findTask, key } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { updateSubject } from './task-subject';
import { prepareTaskWorktree } from './task-worktree';
import { serializeTaskMutation } from './project-task-mutations';
import { parseBuiltinTaskStart, type BuiltinTaskStart } from './builtin-task-start';
import { saveBuiltinRunSettings } from './builtin-run-settings';
import { CommandCancelled } from './owner-commands';

/**
 * A new run of a task (or of a stage acceptance): its checkout, its record and its feed. No
 * agent works yet: a turn starts it, and the merge of a stage needs the feed alone.
 */
export async function createTaskRun(
  ctx: TaskRunEngine,
  projectId: string,
  taskId: string,
  builtin?: BuiltinTaskStart,
  requireCurrent?: () => void,
): Promise<ActiveRun> {
  return serializeTaskMutation(ctx.project(projectId), () =>
    createLockedTaskRun(ctx, projectId, taskId, builtin, requireCurrent),
  );
}

async function createLockedTaskRun(
  ctx: TaskRunEngine,
  projectId: string,
  taskId: string,
  builtin?: BuiltinTaskStart,
  requireCurrent?: () => void,
): Promise<ActiveRun> {
  const context = ctx.project(projectId);
  const artifacts = await context.load();
  const task = findTask(artifacts, taskId);
  const currentBuiltin = () => {
    if (!builtin || !requireCurrent) throw new CommandCancelled();
    requireCurrent();
  };
  if (builtin) {
    currentBuiltin();
    if (!ctx.deps.builtinSessions) throw new Error('Builtin task authorization is unavailable');
    if (ctx.active.has(key(projectId, taskId)) || ctx.deps.db.listRuns(projectId, taskId).length)
      throw new Error('The task already owns a run');
    await ctx.deps.builtinSessions.resolveStart(builtin, new AbortController().signal);
    currentBuiltin();
    const blocker = startBlocker(task, indexTasks(artifacts.tasks));
    if (blocker) throw new Error(`The task cannot start: ${blocker}`);
  }
  const settings = builtin
    ? parseBuiltinTaskStart(builtin)
    : ctx.views.settings(projectId, task, artifacts);
  const adapterVersion =
    settings.agent === 'skaro'
      ? ctx.deps.builtinSessions!.adapterVersion
      : ctx.deps.agents.adapter(settings.agent).adapterVersion;

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
  if (builtin) currentBuiltin();
  await updateSubject(context, taskId, {
    status: 'in_progress',
    ...(branch ? { branch } : {}),
  });
  context.invalidate();
  if (builtin) {
    try {
      currentBuiltin();
    } catch (error) {
      // No run/process exists yet. Keep an interrupted startup from stranding the board.
      await updateSubject(context, taskId, { status: task.status });
      context.invalidate();
      throw error;
    }
  }

  const logPath = join(
    'runs',
    projectId,
    taskId,
    `${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`,
  );
  const run = ctx.deps.db.createRun({
    projectId,
    taskId,
    agent: settings.agent,
    ...(settings.model ? { model: settings.model } : {}),
    ...(worktree ? { worktree } : {}),
    ...(branch ? { branch } : {}),
    logPath,
    adapterVersion,
  });
  if (settings.agent === 'skaro')
    saveBuiltinRunSettings(ctx.deps.db, run.id, parseBuiltinTaskStart(settings));
  const active = new ActiveRun(projectId, taskId, run, new Timeline());
  ctx.active.set(key(projectId, taskId), active);
  ctx.continuation.execution(active).start();
  return active;
}
