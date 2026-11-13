import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { git, type RunRecord } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { serializeTaskMutation } from './project-task-mutations';
import { stageIdOf } from './task-stage';
import { prepareTaskWorktree } from './task-worktree';
import { taskRunDirectory } from './task-run-directory';
import { pinWorktreeAccess } from './worktree-access';
import { accessKey, recordKey, type RetainedCheckout } from './worktree-retention-model';

const restoring = new Map<string, Promise<void>>();

/** Explicit access restores the checkout and pins the unknown external consumer durably. */
export function accessTaskWorktree(ctx: TaskRunEngine, run: RunRecord): Promise<string> {
  const context = ctx.project(run.projectId);
  return serializeTaskMutation(context, async () => {
    await restoreCleanedWorktree(ctx, run);
    const directory = taskRunDirectory(context.root, run);
    if (run.worktree) {
      pinWorktreeAccess(ctx.deps.db, run.projectId, directory);
      ctx.deps.db.setSetting(accessKey(run.worktree), Date.now());
    }
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
    resources: ctx.deps.db.resources,
    dataDir: ctx.deps.dataDir,
    projectId: run.projectId,
    taskId: owner,
    branch: saved.branch,
    base: saved.head,
    expectedCommit: saved.head,
  });
}
