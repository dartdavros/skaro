import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ArtifactStore, MergeBlockedError, newlyUnblocked, type MergeCheck } from '@skaro/core';
import type { ProjectContext } from './projects';
import type { ActiveRun, TaskRunDeps } from './tasks';
import type { MergeTaskArgs } from '@skaro/mcp-server';
import type { TaskMergeHooks } from './task-merge-refresh';
import { MergeCardRefresh } from './task-merge-refresh';
import { mergeInteraction, withStage, type MergeInteraction } from './task-merge-card';
import { taskSections, withSummary } from './task-body';
import { requestTaskMerge } from './task-merge-request';
import { closeMergeCards, recordedTaskMerge } from './task-merge-result';
import { runChecks } from './check-runner';
import { undoTaskMerge } from './task-merge-undo';
import { confirmStageMerge } from './stage-merge-confirm';
import { stageMergeInfo } from './stage-merge';
import { stageNotice } from './stage-views';
import { readLedger } from './task-stage';
import { subjectOf, subjectStage, updateSubject } from './task-subject';

export class TaskMerges {
  private readonly refresh: MergeCardRefresh;
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly hooks: TaskMergeHooks & { deps: TaskRunDeps };
  constructor(hooks: TaskMergeHooks & { deps: TaskRunDeps }) {
    this.hooks = hooks;
    this.refresh = new MergeCardRefresh(hooks);
  }

  watch(active: ActiveRun): void {
    this.refresh.watch(active);
  }
  close(): void {
    this.refresh.close();
  }
  revert(active: ActiveRun, context: ProjectContext, commit: string): Promise<string> {
    return this.enqueue(active, () => undoTaskMerge(active, context, commit, this.hooks));
  }

  request(args: MergeTaskArgs, active: ActiveRun, context: ProjectContext) {
    return this.enqueue(active, () =>
      requestTaskMerge(args, active, context, this.hooks, {
        confirm: () => this.performConfirm(active, context, undefined, active.commitMessage ?? ''),
        showCard: () => this.performShowCard(active, context),
      }),
    );
  }

  /** `partial`: «Влить готовое» of a stage, the finished tasks while the stage goes on. */
  showCard(active: ActiveRun, context: ProjectContext, options: { partial?: boolean } = {}) {
    return this.enqueue(active, () => this.performShowCard(active, context, options));
  }

  private async performShowCard(
    active: ActiveRun,
    context: ProjectContext,
    options: { partial?: boolean } = {},
  ): Promise<MergeInteraction | undefined> {
    context.invalidate();
    const artifacts = await context.load();
    const task = subjectOf(artifacts, active.taskId);
    if (!task) throw new Error('The task no longer exists');
    const stage = subjectStage(artifacts, active.taskId);
    if (task.status === 'done') {
      closeMergeCards(active, this.hooks);
      return undefined;
    }
    const previous = active.timeline.state.interactions.find(
      (i): i is MergeInteraction => i.kind === 'merge',
    );
    const label = `${task.id} · ${task.title}`;
    if (stage) {
      // A stage is never stored as "in review": the first card of its full merge says so.
      if (!previous && !options.partial) {
        this.hooks.deps.db.addEvent(active.projectId, 'stage_review', { stage: stage.id });
        this.hooks.deps.notify?.(
          'review',
          stage.title,
          stageNotice('review', stage.id, this.hooks.deps.locale()),
        );
      }
    } else if (task.status !== 'review') {
      await updateSubject(context, task.id, { status: 'review' });
      context.invalidate();
      this.hooks.deps.db.addEvent(active.projectId, 'task_review', { task: task.id });
      this.hooks.deps.notify?.('review', label);
    }
    await context.git.commitAll(
      active.run.worktree!,
      (stage && active.commitMessage?.trim()) || `${task.id}: ${task.title}`,
    );
    const check = await context.git.checkMerge(artifacts.config.baseBranch, active.run.branch!);
    if (previous)
      this.hooks.skaroEvent(active, {
        t: 'interaction.closed',
        id: previous.id,
        resolution: 'cancelled',
      });
    const card = mergeInteraction(
      randomUUID(),
      active.run.branch!,
      artifacts.config.baseBranch,
      check,
    );
    if (stage) {
      const ledger = readLedger(this.hooks.deps.db, active.projectId, stage.id);
      const partial = options.partial ?? false;
      withStage(
        card,
        stageMergeInfo(stage, artifacts, ledger, { partial, previous: previous?.stage }),
      );
    } else if (active.commitMessage) card.message = active.commitMessage;
    this.hooks.skaroEvent(active, { t: 'interaction.opened', interaction: card });
    this.hooks.settleRuntime(active);
    this.watch(active);
    return card;
  }
  /** The merge itself: after "Влить" on the card, or on its own when the project merges automatically. */
  confirm(
    active: ActiveRun,
    context: ProjectContext,
    card: MergeInteraction | undefined,
    message: string,
  ) {
    return this.enqueue(active, () => this.performConfirm(active, context, card, message));
  }

  private async enqueue<T>(active: ActiveRun, action: () => Promise<T>): Promise<T> {
    // Serialize the whole lifecycle, including reading/updating task metadata.
    this.refresh.busy.add(active.projectId);
    const previous = this.pending.get(active.projectId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    this.pending.set(active.projectId, current);
    try {
      return await current;
    } finally {
      if (this.pending.get(active.projectId) === current) {
        this.pending.delete(active.projectId);
        this.refresh.busy.delete(active.projectId);
        await this.refresh.refresh();
      }
    }
  }

  private async performConfirm(
    active: ActiveRun,
    context: ProjectContext,
    card: MergeInteraction | undefined,
    message: string,
  ): Promise<{ commit: string; base: string }> {
    context.invalidate();
    const artifacts = await context.load();
    const task = subjectOf(artifacts, active.taskId);
    if (!task) throw new Error('The task no longer exists');
    const configProblems = artifacts.problems.filter((p) => p.path === '.skaro/config.yaml');
    if (configProblems.length) throw new Error(configProblems.map((p) => p.message).join('\n'));
    const stage = subjectStage(artifacts, active.taskId);
    if (stage && task.status !== 'done')
      return confirmStageMerge(active, context, stage, card, this.hooks);
    if (task.status === 'done') {
      closeMergeCards(active, this.hooks);
      const merge = recordedTaskMerge(active, artifacts.config.baseBranch, this.hooks.deps.db);
      if (merge) return merge;
      throw new Error('The task is already completed; there is no recorded merge for this run');
    }
    if (taskSections(task.body).criteria.some((criterion) => !criterion.done))
      throw new Error('The task has unfinished acceptance criteria');
    const base = artifacts.config.baseBranch;
    const branch = active.run.branch!;
    const summaryText = active.mergeSummary ?? lastAgentText(active);
    // Whatever the agent wrote after the card was shown goes into the merge too.
    if (active.run.worktree)
      await context.git.commitAll(active.run.worktree, `${task.id}: ${task.title}`);
    let result: { commit: string; check: MergeCheck; before: string };
    try {
      result = await context.git.merge({
        base,
        branch,
        strategy: artifacts.config.merge.strategy,
        worktree: active.run.worktree,
        message: message.trim() || `${task.id}: ${task.title}`,
        managedPaths: [task.path],
        verify: (checkout) => runChecks(checkout, artifacts.config.checks),
        beforeCommit: async (checkout) => {
          const path = join(checkout, task.path);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, await readFile(join(context.root, task.path)));
          const store = new ArtifactStore(checkout);
          const current = await store.readTask(task.id);
          if (taskSections(current.body).criteria.some((criterion) => !criterion.done))
            throw new Error('The task has unfinished acceptance criteria');
          const updated = await store.updateTask(task.id, {
            status: 'done',
            ...(summaryText ? { body: withSummary(current.body, summaryText) } : {}),
          });
          return [updated.path];
        },
      });
    } catch (error) {
      if (card && error instanceof MergeBlockedError) {
        this.hooks.skaroEvent(active, {
          t: 'interaction.opened',
          interaction: mergeInteraction(card.id, branch, base, error.check),
        });
      }
      context.invalidate();
      throw error;
    }
    active.merged = { commit: result.commit, base };
    context.invalidate();
    const after = await context.load();

    this.hooks.deps.db.recordMerge({
      projectId: active.projectId,
      taskId: task.id,
      branch,
      commit: result.commit,
      strategy: artifacts.config.merge.strategy,
    });
    this.hooks.deps.db.addEvent(active.projectId, 'merged', { task: task.id, base });
    this.hooks.deps.notify?.('merged', `${task.id} · ${task.title}`);
    closeMergeCards(active, this.hooks);
    const unblocked = newlyUnblocked(artifacts.tasks, after.tasks);
    this.hooks.skaroEvent(active, {
      t: 'item.upsert',
      item: {
        id: `skaro-merged-${card?.id ?? result.commit}`,
        turnId: active.timeline.state.turns.at(-1)?.id ?? '',
        kind: 'notice',
        level: 'info',
        code: 'merged',
        merge: { before: result.before, strategy: artifacts.config.merge.strategy },
        text: base,
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'merged', ref: result.commit },
      },
    });

    for (const id of unblocked) this.hooks.changed(active.projectId, id);
    this.hooks.deps.emit('project.changed', { projectId: active.projectId });
    void this.hooks.launchUnblocked(active.projectId, unblocked);

    // Close the agent after its reply. The checkout and its ignored data stay; the task's
    // environment is a disposable copy and goes now, without holding up the merge.
    const cleanup = async (): Promise<void> => {
      await this.hooks.detach(active);
      this.hooks.deps.db.finishRun(active.run.id, 'done');
      this.hooks.setRuntime(active.projectId, active.taskId, 'idle');
      this.hooks.changed(active.projectId, active.taskId);
      void this.hooks.removeEnvironment(active.projectId, active.taskId);
    };
    if (active.session && active.timeline.state.status !== 'idle') active.afterTurn = cleanup;
    else await cleanup();
    return { commit: result.commit, base };
  }
}

/** The last agent reply of the run: the fallback task summary. */
export function lastAgentText(active: ActiveRun): string | undefined {
  const items = active.timeline.state.items;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === 'message' && item.role === 'agent' && !item.parentId && item.text.trim()) {
      return item.text.trim();
    }
  }
  return undefined;
}
