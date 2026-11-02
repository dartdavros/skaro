import type { StageInfo } from '../shared/ipc';
import { orderedStageTasks, stageInfo } from './stage-views';
import { key } from './task-run-helpers';
import type { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { readLedger, stageIdOf, writeLedger } from './task-stage';
import { background } from './background/client';
import { AUTO_MERGE_KEY } from '../shared/ipc';

/** Milestones schedule tasks; they never create agent sessions or their own chats. */
export class TaskRunStages {
  private readonly units = new Map<string, string>();
  private readonly holders = new Map<string, string>();
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  /** Only previously created shared checkouts need mutual exclusion. */
  blocked(k: string): boolean {
    const unit = this.units.get(k);
    if (!unit) return false;
    const holder = this.holders.get(unit);
    return (
      (!!holder && holder !== k) ||
      this.ctx.queue.state().running.some((other) => other !== k && this.units.get(other) === unit)
    );
  }

  async sync(projectId: string, taskId: string): Promise<void> {
    const k = key(projectId, taskId);
    const artifacts = await this.ctx.project(projectId).load();
    const run = this.ctx.active.get(k)?.run ?? this.ctx.deps.db.listRuns(projectId, taskId)[0];
    const task = artifacts.tasks.find((item) => item.id === taskId);
    const inPlace =
      task &&
      (run
        ? !run.worktree
        : (this.ctx.startup.read(projectId, taskId)?.builtin?.isolation ??
            this.ctx.views.settings(projectId, task, artifacts).isolation) !== 'worktree');
    const stageId = inPlace ? '__main__' : run && stageIdOf(run);
    if (!stageId) this.units.delete(k);
    else {
      const unit = key(projectId, stageId);
      this.units.set(k, unit);
      const holder = artifacts.tasks.find((task) => {
        const existing =
          this.ctx.active.get(key(projectId, task.id))?.run ??
          this.ctx.deps.db.listRuns(projectId, task.id)[0];
        return (
          existing &&
          (inPlace ? !existing.worktree : stageIdOf(existing) === stageId) &&
          (task.status === 'in_progress' || task.status === 'failed')
        );
      });
      if (holder) this.holders.set(unit, key(projectId, holder.id));
      else this.holders.delete(unit);
    }
    this.ctx.queue.poke();
  }

  /** Retain provenance for an unfinished task in a legacy shared checkout. */
  async opened(active: ActiveRun): Promise<void> {
    const stageId = stageIdOf(active.run);
    if (!stageId) return;
    const ledger = readLedger(this.ctx.deps.db, active.projectId, stageId);
    if (ledger.open[active.taskId]) return;
    ledger.open[active.taskId] = await this.ctx
      .project(active.projectId)
      .git.head('HEAD', active.run.worktree);
    writeLedger(this.ctx.deps.db, active.projectId, stageId, ledger);
  }

  /**
   * «Продолжить» of a stage with nothing left to start: its accepted tasks are merged one by
   * one, dependencies first. Without the automatic merge each task waits for its own card.
   */
  async accept(projectId: string, stageId: string): Promise<void> {
    if (this.ctx.deps.db.getSetting<boolean | null>(AUTO_MERGE_KEY, null) !== true) return;
    const context = this.ctx.project(projectId);
    context.invalidate();
    const tasks = orderedStageTasks({ id: stageId }, await context.load());
    if (!tasks.some((task) => task.status === 'review')) return;
    await this.ctx.merges.coordinator.merge(projectId, stageId);
  }

  async list(projectId: string): Promise<StageInfo[]> {
    if (this.ctx.deps.db.filePath !== ':memory:') {
      this.ctx.project(projectId);
      return background(
        this.ctx.deps.dataDir,
        'tasks.stages',
        this.ctx.deps.db.filePath,
        projectId,
      );
    }
    const artifacts = await this.ctx.project(projectId).load();
    const runtime = this.ctx.deps.db.getTaskRuntime(projectId);
    const awaiting = new Set(Object.keys(this.ctx.scheduling.awaiting(projectId)));
    const integrations = this.ctx.integrations.store.all(projectId);
    return [...artifacts.milestones]
      .sort((a, b) => a.order - b.order)
      .map((stage) =>
        stageInfo(stage, artifacts, runtime, { awaiting, accepted: false, integrations }),
      );
  }

  async start(projectId: string, stageId: string, message: string): Promise<void> {
    const artifacts = await this.ctx.project(projectId).load();
    const todo = orderedStageTasks({ id: stageId }, artifacts).filter(
      (task) => task.status === 'todo',
    );
    if (todo.length)
      await this.ctx.scheduling.launch(
        projectId,
        todo.map((task) => task.id),
        message,
      );
    else await this.accept(projectId, stageId);
    this.ctx.deps.emit('project.changed', { projectId });
  }

  async stop(projectId: string, stageId: string): Promise<void> {
    const artifacts = await this.ctx.project(projectId).load();
    const ids = orderedStageTasks({ id: stageId }, artifacts).map((task) => task.id);
    this.ctx.scheduling.forgetAwaiting(projectId, ids);
    for (const id of ids) await this.ctx.messages.interrupt(projectId, id);
    this.ctx.deps.emit('project.changed', { projectId });
  }
}
