import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArtifactStore } from '@skaro/core';
import type { ActiveRun, TaskRunDeps } from './task-run-model';
import type { ProjectContext } from './projects';
import type { TaskMergeHooks } from './task-merge-refresh';
import { readLedger } from './task-stage';
import { subjectOf, subjectStage } from './task-subject';

/** Invoked inside the same project queue as merge confirmation. */
export async function undoTaskMerge(
  active: ActiveRun,
  context: ProjectContext,
  commit: string,
  hooks: TaskMergeHooks & { deps: TaskRunDeps },
): Promise<string> {
  const record = hooks.deps.db
    .listMerges(active.projectId, active.taskId)
    .find((merge) => merge.commit === commit);
  if (!record) throw new Error('This commit is not a recorded merge of this task');
  if (record.revertCommit) return record.revertCommit;
  if (active.timeline.state.status !== 'idle' || active.session)
    throw new Error('Wait for the task agent to finish before reverting its merge');
  context.invalidate();
  const artifacts = await context.load();
  const task = subjectOf(artifacts, active.taskId);
  // A stage merge took several tasks: they all return to review.
  const stage = subjectStage(artifacts, active.taskId);
  const taken = stage
    ? (readLedger(hooks.deps.db, active.projectId, stage.id).merged.find(
        (merge) => merge.commit === commit,
      )?.tasks ?? [])
    : [active.taskId];
  const returned = artifacts.tasks.filter((t) => taken.includes(t.id));
  if (!task || !returned.length || returned.some((t) => t.status !== 'done'))
    throw new Error('Only a completed task merge can be reverted');
  const latest = hooks.deps.db
    .listMerges(active.projectId, active.taskId)
    .find((merge) => !merge.revertCommit);
  if (latest?.id !== record.id) throw new Error('Revert the latest task merge first');
  if ((await context.git.currentBranch()) !== artifacts.config.baseBranch)
    throw new Error(`Switch the main working copy to ${artifacts.config.baseBranch}`);
  const notice = active.timeline.state.items.find(
    (item) => item.kind === 'notice' && item.code === 'merged' && item.native.ref === commit,
  );
  const before = notice?.kind === 'notice' ? notice.merge?.before : undefined;
  if (record.strategy === 'rebase' && !before)
    throw new Error(
      'This older rebase merge has no recorded base head; automatic reversal is unavailable',
    );
  const result = await context.git.revert(commit, `Revert ${task.id}: ${task.title}`, {
    ...(record.strategy === 'rebase' ? { before } : {}),
    managedPaths: returned.map((t) => t.path),
    beforeCommit: async (checkout) => {
      const store = new ArtifactStore(checkout);
      for (const item of returned) {
        await writeFile(join(checkout, item.path), await readFile(join(context.root, item.path)));
        await store.updateTask(item.id, { status: 'review' });
      }
      return returned.map((t) => t.path);
    },
  });
  if (!result.ok) throw new Error(`Revert conflicts: ${result.conflicts.join(', ')}`);
  hooks.deps.db.markMergeReverted(record.id, result.commit);
  hooks.deps.db.addEvent(active.projectId, 'merge_reverted', {
    task: task.id,
    commit,
    revert: result.commit,
  });
  active.merged = undefined;
  context.invalidate();
  if (notice)
    hooks.skaroEvent(active, {
      t: 'item.upsert',
      item: {
        ...notice,
        kind: 'notice',
        code: 'other',
        level: 'info',
        text: hooks.deps.locale() === 'ru' ? 'Слияние отменено' : 'Merge reverted',
        native: { agent: 'skaro', type: 'merge_reverted', ref: result.commit },
      },
    });
  for (const item of returned) hooks.changed(active.projectId, item.id);
  hooks.changed(active.projectId, active.taskId);
  hooks.deps.emit('project.changed', { projectId: active.projectId });
  return result.commit;
}
