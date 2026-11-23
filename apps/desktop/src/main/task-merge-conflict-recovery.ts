import { git, type CoordinationBlocker, type Task } from '@skaro/core';
import { AUTO_MERGE_KEY } from '../shared/ipc';
import { CompletionStore, criteriaRevision } from './completion-store';
import { acceptedResult, assertResultUnchanged } from './completion-results';
import { assertPublicationDependencies } from './completion-dependencies';
import {
  dispatchState,
  migrationBlocksDispatch,
  requireCoordinationDispatch,
} from './coordination-dispatch';
import { IntegrationPending } from './integration-model';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import { mergeHead, unmergedFiles } from './integration-git';
import { prepareConflictCandidate } from './completion-local-publication';

/** The manual resolve action grants preparation. The eventual merge still needs its card. */
export async function resolveRepeatedTaskConflict(ctx: TaskRunEngine, active: ActiveRun) {
  const { projectId, taskId } = active;
  const { db } = ctx.deps;
  if (!new CompletionStore(db, projectId).conflicts().includes(taskId)) return false;
  const dispatch = requireCoordinationDispatch(db, projectId);
  const context = ctx.project(projectId);
  try {
    await ctx.merges.coordinator.serialized(projectId, async () => {
      const artifacts = await context.load();
      const task = artifacts.tasks.find((item) => item.id === taskId);
      if (!task || task.status !== 'review' || task.archived)
        throw new Error('The result is no longer awaiting merge.');
      const result = await acceptedResult(db, context, task);
      await assertResultUnchanged(context, result);
      requireCoordinationDispatch(db, projectId, dispatch.revision);
      const candidate = await prepareConflictCandidate(
        ctx.integrations.service,
        context,
        artifacts,
        result,
        false,
      );
      ctx.integrations.enqueue(candidate);
    });
  } catch (error) {
    if (!(error instanceof IntegrationPending)) throw error;
  }
  ctx.results.closeMergeCard(active);
  return true;
}

/** Git evidence clears the interruption. The task still needs its affected checks and submission. */
export async function checkTaskMergeConflict(ctx: TaskRunEngine, row: CoordinationBlocker) {
  if (row.subject.kind !== 'run') return false;
  const run = ctx.deps.db.getRun(row.subject.id);
  if (!run?.worktree || !run.branch || run.projectId !== row.projectId) return false;
  const context = ctx.project(run.projectId);
  const branch = await git(run.worktree, ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    allowFail: true,
  });
  if (
    branch.stdout.trim() !== run.branch ||
    (await mergeHead(run.worktree)) ||
    (await unmergedFiles(run.worktree)).length
  )
    return false;
  const base = (await context.load()).config.baseBranch;
  const head = await context.git.head(base);
  return (
    (await git(run.worktree, ['merge-base', '--is-ancestor', head, 'HEAD'], { allowFail: true }))
      .code === 0
  );
}

/** Escalate a stalled first pass only when the accepted input can still be used verbatim. */
export async function handoffStalledMerge(ctx: TaskRunEngine, active: ActiveRun, task: Task) {
  const { projectId, taskId } = active;
  const { db } = ctx.deps;
  if (!ctx.deps.coordinators) return false;
  const store = new CompletionStore(db, projectId);
  if (!store.conflicts().includes(taskId)) return false;
  const dispatch = dispatchState(db, projectId);
  if (!dispatch.enabled || migrationBlocksDispatch(db, projectId)) return false;
  const execution = ctx.continuation.execution(active);
  const intent = execution.intentVersion();
  const current = () =>
    !ctx.closing &&
    execution.read().enabled &&
    execution.intentVersion() === intent &&
    dispatchState(db, projectId).revision === dispatch.revision;

  const context = ctx.project(projectId);
  const accepted = store.result(taskId);
  if (
    !accepted ||
    task.status !== 'in_progress' ||
    task.archived ||
    accepted.criteria !== criteriaRevision(task)
  )
    return false;
  try {
    await assertResultUnchanged(context, accepted);
    const artifacts = await context.load();
    assertPublicationDependencies(artifacts, [accepted], store);
    if (!current()) return false;
    await context.store.updateTask(taskId, { status: 'review' });
    context.invalidate();
    if (!current()) return false;
    const publish = db.getSetting<boolean | null>(AUTO_MERGE_KEY, null) === true;
    const candidate = await prepareConflictCandidate(
      ctx.integrations.service,
      context,
      artifacts,
      accepted,
      publish,
    );
    if (current()) ctx.integrations.enqueue(candidate);
    return true;
  } catch (error) {
    if (error instanceof IntegrationPending) return true;
    // Preserve a partially resolved index, a changed branch or a pending C4 review in place.
    return false;
  }
}
