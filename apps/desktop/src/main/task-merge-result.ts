import type { AppDb, Task } from '@skaro/core';
import type { ActiveRun } from './tasks';
import type { TaskMergeHooks } from './task-merge-refresh';
import { taskSections } from './task-body';

/** Criteria not ticked: what the agent must tell the user instead of "done". */
export function unmetReply(task: Task, open: number[], after: 'result' | 'merge'): string {
  const criteria = taskSections(task.body).criteria;
  const list = open.map((n) => `${n}. ${criteria[n - 1]?.text ?? ''}`).join('\n');
  const head =
    after === 'merge'
      ? 'Skaro did not start the merge: these acceptance criteria are not ticked:'
      : 'Skaro ticked the criteria you reported as met. These are not met:';
  return (
    `${head}\n${list}\n` +
    'The task is not done. Tell the user plainly which criteria are not met and why. Finish ' +
    'them and call submit_result again, or the user ticks a criterion by hand if they accept it.'
  );
}

export function recordedTaskMerge(active: ActiveRun, base: string, db: AppDb) {
  if (active.merged) return active.merged;
  const record = db
    .listMerges(active.projectId, active.taskId)
    .find((merge) => merge.branch === active.run.branch && !merge.revertCommit);
  return record ? { commit: record.commit, base } : undefined;
}

export function mergedTaskReply(merge: { commit: string; base: string }): string {
  return (
    `The task is already merged into ${merge.base} (commit ${merge.commit.slice(0, 7)}). ` +
    'Do not call merge_task or change files anymore. Tell the user the task is done and merged, ' +
    'with a short summary and how each criterion was checked.'
  );
}

export function completedTaskReply(active: ActiveRun, base: string, db: AppDb): string {
  const merge = recordedTaskMerge(active, base, db);
  return merge
    ? mergedTaskReply(merge)
    : 'The task is already completed. Skaro has no recorded merge for this run. ' +
        'Do not call merge_task or change files anymore. Report this status to the user.';
}

export function closeMergeCards(active: ActiveRun, hooks: TaskMergeHooks): void {
  for (const card of [...active.timeline.state.interactions]) {
    if (card.kind === 'merge')
      hooks.skaroEvent(active, { t: 'interaction.closed', id: card.id, resolution: 'answered' });
  }
  hooks.settleRuntime(active);
}
