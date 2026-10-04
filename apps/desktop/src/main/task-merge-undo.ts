import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArtifactStore } from '@skaro/core';
import type { ActiveRun, TaskRunDeps } from './task-run-model';
import type { ProjectContext } from './projects';
import type { TaskMergeHooks } from './task-merge-refresh';

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
  const task = artifacts.tasks.find((task) => task.id === active.taskId);
  if (!task || task.status !== 'done')
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
    managedPaths: [task.path],
    beforeCommit: async (checkout) => {
      await writeFile(join(checkout, task.path), await readFile(join(context.root, task.path)));
      const store = new ArtifactStore(checkout);
      const updated = await store.updateTask(task.id, { status: 'review' });
      return [updated.path];
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
  hooks.changed(active.projectId, active.taskId);
  hooks.deps.emit('project.changed', { projectId: active.projectId });
  return result.commit;
}
