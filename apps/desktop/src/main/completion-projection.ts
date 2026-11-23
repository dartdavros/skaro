import { newlyUnblocked } from '@skaro/core';
import type { ProjectContext } from './projects';
import type { CompletionHooks } from './completion-coordinator';
import {
  CompletionStore,
  criteriaRevision,
  type CompletionOperation,
  type TaskResult,
} from './completion-store';

export async function finishCompletion(
  hooks: CompletionHooks,
  context: ProjectContext,
  store: CompletionStore,
  op: CompletionOperation,
): Promise<void> {
  if (!op.commit) throw new Error('Completion candidate was not recorded');
  context.invalidate();
  const before = (await context.load()).tasks;
  const projected: TaskResult[] = [];
  for (const result of op.results) {
    const task = before.find((item) => item.id === result.taskId);
    if (
      !task ||
      !['review', 'done'].includes(task.status) ||
      criteriaRevision(task) !== result.criteria
    )
      continue;
    projected.push(result);
    store.conflict(task.id, false);
    store.issue(task.id);
    if (task.milestone) store.issue(task.milestone);
    if (task.status === 'review') await context.store.updateTask(task.id, { status: 'done' });
    if (!hooks.deps.db.listMerges(context.id, task.id).some((merge) => merge.commit === op.commit))
      hooks.deps.db.recordMerge({
        projectId: context.id,
        taskId: task.id,
        branch: result.branch,
        commit: op.commit,
        strategy: op.strategy,
      });
    for (const run of hooks.deps.db.listRuns(context.id, task.id))
      if (!run.endedAt) hooks.deps.db.finishRun(run.id, 'done');
    hooks.deps.db.setTaskRuntime(context.id, task.id, 'idle');
  }
  context.invalidate();
  if (op.state !== 'completed') {
    hooks.deps.db.addEvent(context.id, 'merged', {
      tasks: op.results.map((r) => r.taskId),
      commit: op.commit,
    });
    op.state = 'completed';
    delete op.error;
    store.save(op);
  }
  const unblocked = newlyUnblocked(
    before.map((task) =>
      task.status === 'done' && op.results.some((result) => result.taskId === task.id)
        ? { ...task, status: 'review' as const }
        : task,
    ),
    (await context.load()).tasks,
  );
  hooks.deps.emit('project.changed', { projectId: context.id });
  await hooks.completed(context.id, { ...op, results: projected }, unblocked);
}
