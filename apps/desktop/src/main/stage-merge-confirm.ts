import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ArtifactStore,
  git,
  MergeBlockedError,
  newlyUnblocked,
  type MergeCheck,
  type Milestone,
} from '@skaro/core';
import { runChecks } from './check-runner';
import type { ProjectContext } from './projects';
import { mergingTasks, rewordStageCommits, stageMergeInfo } from './stage-merge';
import { mergeInteraction, withStage, type MergeInteraction } from './task-merge-card';
import type { TaskMergeHooks } from './task-merge-refresh';
import { closeMergeCards } from './task-merge-result';
import type { ActiveRun, TaskRunDeps } from './task-run-model';
import { readLedger, stageTasks, writeLedger } from './task-stage';

type Hooks = TaskMergeHooks & { deps: TaskRunDeps };

/**
 * Merges a stage: the finished tasks go into the base branch, a commit per task with the
 * messages of the card. «Влить готовое» leaves the stage working; a full merge ends it.
 */
export async function confirmStageMerge(
  active: ActiveRun,
  context: ProjectContext,
  stage: Milestone,
  card: MergeInteraction | undefined,
  hooks: Hooks,
): Promise<{ commit: string; base: string }> {
  const { projectId } = active;
  const db = hooks.deps.db;
  const artifacts = await context.load();
  let ledger = readLedger(db, projectId, stage.id);
  const info =
    card?.stage ??
    stageMergeInfo(stage, artifacts, ledger, { partial: false, previous: undefined });
  const tasks = mergingTasks(stage, artifacts);
  if (!tasks.length) throw new Error('The stage has no finished tasks to merge');
  const working = stageTasks(stage, artifacts).filter(
    (t) => t.status === 'in_progress' || t.status === 'failed',
  );
  if (working.length)
    throw new Error(`Wait for ${working.map((t) => t.id).join(', ')} of the stage to finish`);
  if (!info.partial) {
    const todo = stageTasks(stage, artifacts).filter((t) => t.status === 'todo');
    if (todo.length) throw new Error('The stage has tasks that are not done');
    if (stageMergeInfo(stage, artifacts, ledger, { partial: false }).unmet.length)
      throw new Error('The readiness criterion of the stage is not ticked');
  }

  const base = artifacts.config.baseBranch;
  const branch = active.run.branch!;
  const worktree = active.run.worktree!;
  const title = `${stage.id}: ${stage.title}`;
  await context.git.commitAll(worktree, active.commitMessage?.trim() || title);
  ledger = await rewordStageCommits(worktree, base, ledger, info);
  writeLedger(db, projectId, stage.id, ledger);
  // The commits of the tasks are kept: "squash" means a commit per task here, not one for all.
  const strategy = artifacts.config.merge.strategy === 'merge' ? 'merge' : 'rebase';
  let result: { commit: string; check: MergeCheck; before: string };
  try {
    result = await context.git.merge({
      base,
      branch,
      strategy,
      worktree,
      message: title,
      managedPaths: tasks.map((t) => t.path),
      verify: (checkout) => runChecks(checkout, artifacts.config.checks),
      beforeCommit: async (checkout) => {
        const store = new ArtifactStore(checkout);
        for (const task of tasks) {
          const path = join(checkout, task.path);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, await readFile(join(context.root, task.path)));
          await store.updateTask(task.id, { status: 'done' });
        }
        return tasks.map((t) => t.path);
      },
    });
  } catch (error) {
    if (card && error instanceof MergeBlockedError) {
      hooks.skaroEvent(active, {
        t: 'interaction.opened',
        interaction: withStage(mergeInteraction(card.id, branch, base, error.check), info),
      });
    }
    context.invalidate();
    throw error;
  }
  // The stage goes on from what is merged: its branch takes the commit with the task files.
  if (info.partial) await git(worktree, ['merge', '--ff-only', base], { allowFail: true });
  writeLedger(db, projectId, stage.id, {
    open: ledger.open,
    commits: [],
    merged: [...ledger.merged, { commit: result.commit, tasks: tasks.map((t) => t.id) }],
  });
  active.merged = { commit: result.commit, base };
  context.invalidate();
  const after = await context.load();

  db.recordMerge({ projectId, taskId: stage.id, branch, commit: result.commit, strategy });
  db.addEvent(projectId, 'merged', { stage: stage.id, tasks: tasks.map((t) => t.id), base });
  hooks.deps.notify?.('merged', `${stage.id} · ${stage.title}`);
  closeMergeCards(active, hooks);
  hooks.skaroEvent(active, {
    t: 'item.upsert',
    item: {
      id: `skaro-merged-${card?.id ?? result.commit}`,
      turnId: active.timeline.state.turns.at(-1)?.id ?? '',
      kind: 'notice',
      level: 'info',
      code: 'merged',
      merge: {
        before: result.before,
        strategy,
        tasks: tasks.length,
        ...(info.partial ? { partial: true } : {}),
      },
      text: base,
      status: 'done',
      startedAt: Date.now(),
      native: { agent: 'skaro', type: 'merged', ref: result.commit },
    },
  });
  const unblocked = newlyUnblocked(artifacts.tasks, after.tasks);
  for (const id of [...tasks.map((t) => t.id), ...unblocked]) hooks.changed(projectId, id);
  hooks.deps.emit('project.changed', { projectId });
  void hooks.launchUnblocked(projectId, unblocked);

  // The merged tasks are over: their agents close. The stage itself ends with a full merge.
  const merged = new Set(tasks.map((t) => t.id));
  for (const id of merged) {
    const run = await hooks.restore(projectId, id).catch(() => undefined);
    if (!run) continue;
    // The feed of the task says where its work went; the merge is undone on the stage.
    hooks.skaroEvent(run, {
      t: 'item.upsert',
      item: {
        id: `skaro-stage-merged-${result.commit}`,
        turnId: run.timeline.state.turns.at(-1)?.id ?? '',
        kind: 'notice',
        level: 'info',
        code: 'stage_merged',
        text: base,
        stage: stage.id,
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'stage_merged', ref: result.commit },
      },
    });
    await hooks.detach(run);
    hooks.setRuntime(projectId, id, 'idle');
  }
  for (const id of merged)
    for (const run of db.listRuns(projectId, id)) if (!run.endedAt) db.finishRun(run.id, 'done');
  if (info.partial) return { commit: result.commit, base };
  const cleanup = async (): Promise<void> => {
    await hooks.detach(active);
    db.finishRun(active.run.id, 'done');
    hooks.setRuntime(projectId, active.taskId, 'idle');
    hooks.changed(projectId, active.taskId);
    void hooks.removeEnvironment(projectId, stage.id);
  };
  if (active.session && active.timeline.state.status !== 'idle') active.afterTurn = cleanup;
  else await cleanup();
  return { commit: result.commit, base };
}
