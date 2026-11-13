import type { CompletionHooks } from './completion-coordinator';
import type { ProjectContext } from './projects';
import { CompletionStore, criteriaRevision, type TaskResult } from './completion-store';
import { acceptedResult, containsCommit, assertResultUnchanged } from './completion-results';
import { finishCompletion } from './completion-projection';
import { withSummary } from './task-body';
import { reconcileCompletedPublicationResources } from './completion-recovery-resources';

export async function reconcileCompletions(
  context: ProjectContext,
  hooks: CompletionHooks,
  report: (projectId: string, taskId: string | undefined, error: unknown) => void,
): Promise<void> {
  // Recovery may restore artifact files before their watcher notification arrives.
  // An idle sweep must keep the cached documents and C4 validation.
  if (await context.git.recoverPublication()) context.invalidate();
  const store = new CompletionStore(hooks.deps.db, context.id);
  for (const op of store.operations()) {
    if (
      op.revertCandidate &&
      op.state !== 'reverted' &&
      (await containsCommit(context, op.base, op.revertCandidate.commit))
    ) {
      for (const result of op.results)
        for (const merge of hooks.deps.db.listMerges(context.id, result.taskId))
          if (merge.commit === op.commit && !merge.revertCommit)
            hooks.deps.db.markMergeReverted(merge.id, op.revertCandidate.commit);
      op.state = 'reverted';
      store.save(op);
      hooks.deps.emit('project.changed', { projectId: context.id });
    }
    if (op.state === 'completed' || op.state === 'reverted' || !op.commit) continue;
    if (await containsCommit(context, op.base, op.commit))
      await finishCompletion(hooks, context, store, op);
  }
  await reconcileCompletedPublicationResources(context, hooks, store.operations());
  const artifacts = await context.summary();
  for (const task of artifacts.tasks) {
    const result = store.result(task.id);
    if (!result?.pendingReview || hooks.busy(context.id, task.id)) continue;
    if (task.status === 'done' || task.status === 'cancelled' || task.archived) {
      store.saveResult({ ...result, pendingReview: false });
      continue;
    }
    if (criteriaRevision(task) !== result.criteria) continue;
    try {
      await assertResultUnchanged(context, result);
    } catch (error) {
      report(context.id, task.id, error);
      continue;
    }
    await context.store.updateTask(task.id, {
      status: 'review',
      ...(!task.branch && !result.sharedCheckout ? { branch: result.branch } : {}),
      ...(result.summary ? { body: withSummary(task.body, result.summary) } : {}),
    });
    store.saveResult({ ...result, pendingReview: false });
    context.invalidate();
    hooks.deps.emit('project.changed', { projectId: context.id });
  }
  const current = await context.summary();
  for (const task of current.tasks.filter((item) => item.status === 'review' && !item.archived)) {
    if (hooks.busy(context.id, task.id)) continue;
    // Reverted historical merges are never inferred as completed from ancestry alone.
    if (hooks.deps.db.listMerges(context.id, task.id)[0]?.revertCommit) continue;
    let result: TaskResult;
    try {
      result = await acceptedResult(hooks.deps.db, context, task);
    } catch (error) {
      report(context.id, task.id, error);
      continue;
    }
    if (
      store
        .operations()
        .some(
          (op) =>
            op.state === 'reverted' &&
            op.results.some((item) => item.taskId === result.taskId && item.head === result.head),
        ) ||
      !(await containsCommit(context, artifacts.config.baseBranch, result.head))
    )
      continue;
    try {
      await assertResultUnchanged(context, result);
    } catch (error) {
      report(context.id, task.id, error);
      continue;
    }
    const op = store.create(artifacts.config.baseBranch, [result], 'merge');
    op.commit = result.head;
    op.external = true;
    store.save(op);
    await finishCompletion(hooks, context, store, op);
  }
}
