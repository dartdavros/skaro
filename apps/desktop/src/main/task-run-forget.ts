import { key, settingsKey } from './task-run-helpers';
import { ownsCheckout } from './task-stage';
import type { TaskRunEngine } from './task-run-engine';
import {
  prepareTaskWorktreeRemoval,
  removePreparedTaskWorktree,
  type TaskWorktreeRemoval,
} from './task-worktree-deletion';

/** Explicit task deletion retains every existing preflight and the resource ledger's boundaries. */
export async function forgetTaskRun(
  ctx: TaskRunEngine,
  projectId: string,
  taskId: string,
): Promise<void> {
  if (ctx.deps.db.shell.projectScope && ctx.deps.db.shell.projectScope !== projectId)
    throw new Error('Project is outside verification scope');
  const k = key(projectId, taskId);
  if (
    ctx.integrations.store
      .all(projectId)
      .some(
        (op) =>
          (op.taskId === taskId || op.results.some((result) => result.taskId === taskId)) &&
          (op.worker || op.executor),
      )
  )
    throw new Error('Stop the task integration before deleting its checkout.');
  const git = ctx.project(projectId).git;
  const runs = ctx.deps.db.listRuns(projectId, taskId);
  // A legacy stage checkout, branch and environment still belong to its other tasks.
  const own = runs.filter(ownsCheckout);
  const worktrees = new Set(own.flatMap((run) => (run.worktree ? [run.worktree] : [])));
  const branches = new Set(own.flatMap((run) => (run.branch ? [run.branch] : [])));
  const active = ctx.active.get(k);
  if (active?.switching) throw new Error('The agent is being changed; retry after the handoff.');
  ctx.continuation.stop(projectId, taskId);
  ctx.startup.cancel(projectId, taskId);
  ctx.scheduling.forgetAwaiting(projectId, [taskId]);
  ctx.queue.cancel(k);
  ctx.queuedInputs.delete(k);
  await ctx.reviews.stop(projectId, taskId);
  if (active) {
    active.deliveryEpoch++;
    await ctx.sessions.detach(active);
    await active.pumping;
  }
  for (const run of runs) await ctx.processes.stop(run.id);
  // Containers retain mounts while stopped. Their own ledger guards precede removal.
  if (own.length === runs.length)
    await ctx.removeEnvironment({ projectId, taskId }, { requireSuccess: true });
  const prepared: TaskWorktreeRemoval[] = [];
  for (const path of worktrees) {
    const candidate = await prepareTaskWorktreeRemoval(
      ctx,
      projectId,
      taskId,
      path,
      runs.map((run) => run.id),
    );
    if (candidate) prepared.push(candidate);
  }
  for (const candidate of prepared)
    await removePreparedTaskWorktree(ctx, projectId, taskId, candidate);
  for (const branch of branches) await git.deleteBranch(branch);
  // Failed preflight/removal keeps task and run metadata available to recover and retry.
  if (active) {
    active.log?.end();
    ctx.active.delete(k);
  }
  for (const run of runs) if (!run.endedAt) ctx.deps.db.finishRun(run.id, 'interrupted');
  ctx.deps.db.setSetting(settingsKey(projectId, taskId), null);
  ctx.setRuntime(projectId, taskId, 'idle');
  await ctx.stages.sync(projectId, taskId);
}
