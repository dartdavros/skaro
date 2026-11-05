import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { git, type RunRecord, type Task } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { environmentArtifacts } from './task-environment-finished';
import { serializeTaskMutation } from './project-task-mutations';
import { stageIdOf } from './task-stage';
import { prepareTaskWorktree } from './task-worktree';
import { taskRunDirectory } from './task-run-directory';

type RetainedCheckout = { branch: string; head: string };
const recordKey = (path: string) => `worktree.cleaned.${resolve(path)}`;
const accessKey = (path: string) => `worktree.accessed.${resolve(path)}`;
const restoring = new Map<string, Promise<void>>();

export function completedCheckout(
  tasks: Pick<Task, 'id' | 'milestone' | 'status'>[],
  owner: string,
) {
  const task = tasks.find((item) => item.id === owner);
  const members = task ? [task] : tasks.filter((item) => item.milestone === owner);
  return members.length > 0 && members.every((item) => item.status === 'done');
}

/** Never mutates task/run/history records or deletes the branch holding the original commits. */
export async function cleanCompletedWorktrees(ctx: TaskRunEngine): Promise<void> {
  for (const project of ctx.deps.db.listProjects()) {
    if (ctx.closing) return;
    if (ctx.deps.db.shell.projectScope && ctx.deps.db.shell.projectScope !== project.id) continue;
    const context = ctx.project(project.id);
    const runs = ctx.deps.db.listRuns(project.id);
    const paths = [...new Set(runs.flatMap((run) => (run.worktree ? [run.worktree] : [])))];
    for (const path of paths) {
      if (ctx.closing) return;
      if (!existsSync(path) || checkoutBusy(ctx, project.id, path)) continue;
      // Release the launch gate after each checkout; a large backlog must not lock the board.
      await serializeTaskMutation(context, async () => {
        const artifacts = await environmentArtifacts(context);
        if (!artifacts) return;
        const owners = ctx.deps.db.listRuns(project.id).filter((run) => run.worktree === path);
        const owner = owners[0];
        if (!owner) return;
        const id = stageIdOf(owner) ?? owner.taskId;
        const expected = resolve(ctx.deps.dataDir, 'worktrees', project.id, id);
        if (resolve(path) !== expected || !completedCheckout(artifacts.tasks, id)) return;
        if (owners.some((run) => !completedCheckout(artifacts.tasks, run.taskId))) return;
        if (checkoutBusy(ctx, project.id, path)) return;
        try {
          const managed = resolve(await realpath(ctx.deps.dataDir), 'worktrees', project.id, id);
          if (resolve(await realpath(path)) !== managed) return;
          for (const run of owners) await ctx.processes.stop(run.id);
          const branch = await context.git.currentBranch(path);
          if (!branch || !owners.some((run) => run.branch === branch)) return;
          const head = (await git(path, ['rev-parse', 'HEAD'])).stdout.trim();
          if (
            (await git(context.root, ['rev-parse', `refs/heads/${branch}`])).stdout.trim() !== head
          )
            return;
          await context.git.assertRemovableWorktree(path);
          const fresh = await environmentArtifacts(context);
          if (
            ctx.closing ||
            !fresh ||
            !completedCheckout(fresh.tasks, id) ||
            owners.some((run) => !completedCheckout(fresh.tasks, run.taskId)) ||
            checkoutBusy(ctx, project.id, path)
          )
            return;
          // Persist recovery before removal; never alter task, run or history records.
          ctx.deps.db.setSetting(recordKey(path), { branch, head } satisfies RetainedCheckout);
          await context.git.removeWorktree(path, { preserve: { branch, head } });
        } catch (error) {
          console.info(`Worktree cleanup retained ${path}: ${String(error)}`);
        }
      }).catch((error: unknown) => console.error('Worktree cleanup:', error));
    }
  }
}

function checkoutBusy(ctx: TaskRunEngine, projectId: string, path: string): boolean {
  if (Date.now() - ctx.deps.db.getSetting(accessKey(path), 0) < 24 * 60 * 60_000) return true;
  if (ctx.reviews.protectedEnvironments().some((owner) => owner.projectId === projectId))
    return true;
  const queue = ctx.queue.state();
  if ([...queue.running, ...queue.queued].some((key) => key.startsWith(`${projectId}\n`)))
    return true;
  if (ctx.integrations.store.all(projectId).some((op) => op.worker || op.executor)) return true;
  return [...ctx.active.values()].some(
    (active) =>
      active.run.worktree === path &&
      (active.session ||
        active.attaching ||
        active.switching ||
        active.stopping ||
        active.afterTurn ||
        active.release ||
        active.operations.size ||
        active.timeline.state.status !== 'idle'),
  );
}

/** Explicit file access restores the checkout and grants a day before another cleanup. */
export function accessTaskWorktree(ctx: TaskRunEngine, run: RunRecord): Promise<string> {
  const context = ctx.project(run.projectId);
  return serializeTaskMutation(context, async () => {
    await restoreCleanedWorktree(ctx, run);
    const directory = taskRunDirectory(context.root, run);
    if (run.worktree) ctx.deps.db.setSetting(accessKey(run.worktree), Date.now());
    return directory;
  });
}

/** Recreate only a checkout that this collector removed, from its preserved exact branch. */
export function restoreCleanedWorktree(ctx: TaskRunEngine, run: RunRecord): Promise<void> {
  if (!run.worktree) return Promise.resolve();
  const path = resolve(run.worktree);
  const pending = restoring.get(path);
  if (pending) return pending;
  const operation = restoreCheckout(ctx, run).finally(() => restoring.delete(path));
  restoring.set(path, operation);
  return operation;
}

async function restoreCheckout(ctx: TaskRunEngine, run: RunRecord): Promise<void> {
  if (!run.worktree || existsSync(run.worktree)) return;
  const current = ctx.deps.db.getRun(run.id);
  if (!current || current.retiredAt !== undefined)
    throw new Error('The run belongs to a deleted task.');
  const saved = ctx.deps.db.getSetting<RetainedCheckout | null>(recordKey(run.worktree), null);
  if (!saved || saved.branch !== run.branch) return;
  const context = ctx.project(run.projectId);
  const owner = stageIdOf(run) ?? run.taskId;
  if (resolve(run.worktree) !== resolve(ctx.deps.dataDir, 'worktrees', run.projectId, owner))
    throw new Error('Cleaned worktree is outside its managed directory');
  if (
    resolve(await realpath(dirname(run.worktree))) !==
    resolve(await realpath(ctx.deps.dataDir), 'worktrees', run.projectId)
  )
    throw new Error('Cleaned worktree parent no longer belongs to Skaro');
  if (
    (await git(context.root, ['rev-parse', `refs/heads/${saved.branch}`])).stdout.trim() !==
    saved.head
  )
    throw new Error('The preserved task branch changed after checkout cleanup');
  await prepareTaskWorktree({
    git: context.git,
    dataDir: ctx.deps.dataDir,
    projectId: run.projectId,
    taskId: owner,
    branch: saved.branch,
    base: saved.head,
  });
}
