import { git, newlyUnblocked, taskBranch, type Milestone, type Task } from '@skaro/core';
import type { StageInfo } from '../shared/ipc';
import type { ProjectContext } from './projects';
import { orderedStageTasks, stageInfo } from './stage-views';
import { withSummary } from './task-body';
import { lastAgentText } from './task-merges';
import { createTaskRun } from './task-run-create';
import { key } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { readLedger, stageIdOf, stageOf, stageTasks, writeLedger } from './task-stage';
import { stageStatus, subjectStage } from './task-subject';
import { prepareTaskWorktree } from './task-worktree';

/** What Skaro tells the agent of a stage acceptance when the last task is finished. */
const ACCEPT: Record<string, string> = {
  ru: 'Все задачи этапа сделаны. Проведи приёмку этапа по критерию готовности.',
  en: 'Every task of the milestone is done. Run its acceptance by the readiness criterion.',
};

/** stages: a focused part of the task-run controller (task-stage.ts says what a stage is). */
export class TaskRunStages {
  private readonly ctx: TaskRunEngine;
  /** Queue key of a task → its stage, for the tasks that work in a stage. */
  private readonly units = new Map<string, string>();
  /** Stage → the task that is started and not finished: the checkout is its until it is. */
  private readonly holders = new Map<string, string>();
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  /** Another task of the stage works in the shared checkout: this one waits for it. */
  blocked(k: string): boolean {
    const unit = this.units.get(k);
    if (!unit) return false;
    const holder = this.holders.get(unit);
    if (holder && holder !== k) return true;
    return this.ctx.queue.state().running.some((r) => r !== k && this.units.get(r) === unit);
  }

  /** Reads from the task files who holds the stage now, and lets the queue move on. */
  async sync(projectId: string, taskId: string): Promise<void> {
    const k = key(projectId, taskId);
    const artifacts = await this.ctx.project(projectId).load();
    const task = artifacts.tasks.find((t) => t.id === taskId);
    const run = this.ctx.active.get(k)?.run;
    // The acceptance of a stage is named after its milestone and works in the same checkout.
    const stageId =
      (run && stageIdOf(run)) ??
      (task && !run ? stageOf(task, artifacts)?.id : undefined) ??
      subjectStage(artifacts, taskId)?.id;
    if (!stageId) {
      this.units.delete(k);
    } else {
      const unit = key(projectId, stageId);
      this.units.set(k, unit);
      const holder = stageTasks({ id: stageId }, artifacts).find(
        (t) => t.status === 'in_progress' || t.status === 'failed',
      );
      if (holder) this.holders.set(unit, key(projectId, holder.id));
      else this.holders.delete(unit);
    }
    this.ctx.queue.poke();
  }

  /** The checkout and the branch the tasks of the stage share; made by the first of them. */
  async checkout(
    projectId: string,
    stage: Milestone,
    context: ProjectContext,
  ): Promise<{ worktree: string; branch: string }> {
    const config = (await context.load()).config;
    const branch = stage.branch ?? taskBranch(config, stage);
    const worktree = await prepareTaskWorktree({
      git: context.git,
      dataDir: this.ctx.deps.dataDir,
      projectId,
      taskId: stage.id,
      branch,
      base: config.baseBranch,
    });
    if (!stage.branch) {
      await context.store.updateMilestone(stage.id, { branch });
      context.invalidate();
    }
    return { worktree, branch };
  }

  /** A turn of a stage task begins: its work is counted from where the branch is now. */
  async opened(active: ActiveRun): Promise<void> {
    const stageId = stageIdOf(active.run);
    if (!stageId) return;
    const ledger = readLedger(this.ctx.deps.db, active.projectId, stageId);
    if (ledger.open[active.taskId]) return;
    const context = this.ctx.project(active.projectId);
    ledger.open[active.taskId] = await context.git.head('HEAD', active.run.worktree);
    writeLedger(this.ctx.deps.db, active.projectId, stageId, ledger);
  }

  /**
   * Every criterion of a stage task is ticked: its work becomes one commit in the branch of the
   * stage and the task goes to review. There is no merge card: the stage is merged as a whole.
   */
  async complete(active: ActiveRun, context: ProjectContext, task: Task): Promise<void> {
    const stageId = stageIdOf(active.run)!;
    const { projectId } = active;
    const commit = await this.commit(active, context, task, stageId);
    const before = (await context.load()).tasks;
    // «Итог» of the task is written now: the merge of the stage only marks the task done.
    const summary = active.mergeSummary ?? lastAgentText(active);
    await context.store.updateTask(task.id, {
      status: 'review',
      ...(summary ? { body: withSummary(task.body, summary) } : {}),
    });
    context.invalidate();
    if (task.status !== 'review')
      this.ctx.deps.db.addEvent(projectId, 'task_review', { task: task.id, stage: stageId });
    this.ctx.history.skaroEvent(active, {
      t: 'item.upsert',
      item: {
        id: `skaro-stage-done-${commit}`,
        turnId: active.timeline.state.turns.at(-1)?.id ?? '',
        kind: 'notice',
        level: 'info',
        code: 'stage_done',
        text: stageId,
        stage: stageId,
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'stage_done', ref: commit },
      },
    });
    const unblocked = newlyUnblocked(before, (await context.load()).tasks);
    for (const id of unblocked) this.ctx.changed(projectId, id);
    await this.sync(projectId, task.id);
    void this.ctx.scheduling.launchUnblocked(projectId, unblocked);
    void this.accept(projectId, stageId).catch(() => undefined);
  }

  /**
   * Every task of the stage is finished: its acceptance starts by itself. With nothing to check
   * (no readiness criterion, or every one ticked) the merge card of the stage shows at once.
   */
  async accept(projectId: string, stageId: string): Promise<void> {
    const context = this.ctx.project(projectId);
    context.invalidate();
    const artifacts = await context.load();
    const stage = artifacts.milestones.find((m) => m.id === stageId);
    if (!stage) return;
    const status = stageStatus(stage, artifacts);
    if (status === 'in_progress') {
      const text = ACCEPT[this.ctx.deps.locale()] ?? ACCEPT['en']!;
      await this.ctx.messages.send(projectId, stageId, { text });
    } else if (status === 'review') {
      await this.run(projectId, stageId);
      await this.ctx.results.criteriaChanged(projectId, stageId);
    }
  }

  /** The stages of the project, in plan order. */
  async list(projectId: string): Promise<StageInfo[]> {
    const artifacts = await this.ctx.project(projectId).load();
    const runtime = this.ctx.deps.db.getTaskRuntime(projectId);
    const awaiting = new Set(Object.keys(this.ctx.scheduling.awaiting(projectId)));
    return [...artifacts.milestones]
      .sort((a, b) => a.order - b.order)
      .map((stage) =>
        stageInfo(stage, artifacts, runtime, {
          awaiting,
          accepted: this.ctx.deps.db.listRuns(projectId, stage.id).length > 0,
        }),
      );
  }

  /**
   * «Запустить» and «Продолжить»: the tasks that are not started go in plan order, one after
   * another. With every task finished, the acceptance goes on instead.
   */
  async start(projectId: string, stageId: string, message: string): Promise<void> {
    const artifacts = await this.ctx.project(projectId).load();
    const todo = orderedStageTasks({ id: stageId }, artifacts).filter((t) => t.status === 'todo');
    if (todo.length) {
      await this.ctx.scheduling.launch(
        projectId,
        todo.map((t) => t.id),
        message,
      );
    } else await this.accept(projectId, stageId);
    this.ctx.deps.emit('project.changed', { projectId });
  }

  /** «Остановить»: the working agent stops; tasks told to start no longer wait for their turn. */
  async stop(projectId: string, stageId: string): Promise<void> {
    const artifacts = await this.ctx.project(projectId).load();
    const ids = [...orderedStageTasks({ id: stageId }, artifacts).map((t) => t.id), stageId];
    this.ctx.scheduling.forgetAwaiting(projectId, ids);
    for (const id of ids) await this.ctx.messages.interrupt(projectId, id);
    this.ctx.deps.emit('project.changed', { projectId });
  }

  /** The feed of the stage: its acceptance and its merge cards live there. */
  private async run(projectId: string, stageId: string): Promise<ActiveRun> {
    return (
      this.ctx.active.get(key(projectId, stageId)) ??
      (await this.ctx.history.restore(projectId, stageId)) ??
      (await createTaskRun(this.ctx, projectId, stageId))
    );
  }

  /** «Влить готовое»: a card to merge the finished tasks while the stage goes on. */
  async mergeFinished(projectId: string, stageId: string): Promise<void> {
    const active = await this.run(projectId, stageId);
    await this.ctx.merges.showCard(active, this.ctx.project(projectId), { partial: true });
    this.ctx.changed(projectId, stageId);
  }

  /** Commits what is left and folds the task's commits into one; returns the head of the branch. */
  private async commit(
    active: ActiveRun,
    context: ProjectContext,
    task: Task,
    stageId: string,
  ): Promise<string> {
    const worktree = active.run.worktree!;
    const message = active.commitMessage?.trim() || `${task.id}: ${task.title}`;
    await context.git.commitAll(worktree, message);
    let head = await context.git.head('HEAD', worktree);
    const ledger = readLedger(this.ctx.deps.db, active.projectId, stageId);
    const from = ledger.open[task.id];
    const last = ledger.commits.at(-1)?.commit;
    if (head !== (from ?? last)) {
      // The task's commits sit on top of where it began: one commit replaces them.
      const linear =
        from !== undefined &&
        (await git(worktree, ['merge-base', '--is-ancestor', from, 'HEAD'], { allowFail: true }))
          .code === 0;
      if (linear) {
        await git(worktree, ['reset', '--soft', from]);
        await git(worktree, ['commit', '-qm', message]);
        head = await context.git.head('HEAD', worktree);
      }
      ledger.commits.push({ taskId: task.id, commit: head, message });
    }
    delete ledger.open[task.id];
    writeLedger(this.ctx.deps.db, active.projectId, stageId, ledger);
    return head;
  }
}
