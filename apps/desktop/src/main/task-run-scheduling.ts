import { indexTasks, isBlocked, startBlocker } from '@skaro/core';
import type { MessageInput, RunSlots, TaskAssignment } from '../shared/ipc';
import { createTaskRun } from './task-run-create';
import { checkoutKey, ownsCheckout } from './task-stage';
import { updateSubject } from './task-subject';
import { key, awaitingKey, findTask } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';

/** scheduling: a focused part of the task-run controller. */
export class TaskRunScheduling {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  slots(): RunSlots {
    const { slots, running } = this.ctx.queue.state();
    return { total: slots, free: Math.max(0, slots - running.length) };
  }

  setSlots(slots: number): void {
    this.ctx.queue.setSlots(slots);
    this.ctx.limitEnvironments();
  }

  async launch(
    projectId: string,
    taskIds: string[],
    message: string,
    assignment?: TaskAssignment,
  ): Promise<void> {
    const artifacts = await this.ctx.project(projectId).load();
    const index = indexTasks(artifacts.tasks);
    const awaiting = this.awaiting(projectId);
    for (const id of taskIds) {
      const task = findTask(artifacts, id);
      const blocker = startBlocker(task, index);
      // A blocked task starts on its own once its dependencies are merged.
      if (blocker === 'blocked') awaiting[id] = { message, ...(assignment ? { assignment } : {}) };
      if (blocker) continue;
      const active = this.ctx.active.has(key(projectId, id));
      if (active && task.status !== 'todo') continue;
      if (assignment) await this.ctx.views.assign(projectId, id, assignment);
      // A task taken back to "Не начата" keeps its run: starting it again goes on in that session.
      if (
        task.status === 'todo' &&
        (active || this.ctx.deps.db.listRuns(projectId, id).length > 0)
      ) {
        await this.ctx.project(projectId).store.updateTask(id, { status: 'in_progress' });
        this.ctx.project(projectId).invalidate();
      }
      await this.ctx.messages.send(projectId, id, { text: message });
    }
    this.ctx.deps.db.setSetting(awaitingKey(projectId), awaiting);
  }

  /**
   * "В работе" → "Не начата" on the board: the agent stops (or the task leaves the queue) and the
   * task is not started again; its run, branch and feed stay for the next start.
   */
  async cancel(projectId: string, taskId: string): Promise<void> {
    const context = this.ctx.project(projectId);
    const task = findTask(await context.load(), taskId);
    if (task.status !== 'in_progress' && task.status !== 'todo')
      throw new Error('Only a task in progress can be taken back');
    await this.ctx.messages.interrupt(projectId, taskId);
    const awaiting = this.awaiting(projectId);
    if (awaiting[taskId]) {
      delete awaiting[taskId];
      this.ctx.deps.db.setSetting(awaitingKey(projectId), awaiting);
    }
    if (task.status !== 'todo') await updateSubject(context, taskId, { status: 'todo' });
    context.invalidate();
    this.ctx.changed(projectId, taskId);
    await this.ctx.stages.sync(projectId, taskId);
    // A task taken back does not keep services running; the copy of its data stays. The
    // environment of a stage serves its other tasks and goes on.
    const run = this.ctx.active.get(key(projectId, taskId))?.run;
    if (!run || ownsCheckout(run))
      void this.ctx.environments.stop({ projectId, taskId }).catch(() => undefined);
  }

  awaiting(projectId: string): Record<string, { message: string; assignment?: TaskAssignment }> {
    return this.ctx.deps.db.getSetting(awaitingKey(projectId), {}) ?? {};
  }

  /** The tasks no longer start by themselves when their dependencies are done. */
  forgetAwaiting(projectId: string, taskIds: string[]): void {
    const awaiting = this.awaiting(projectId);
    for (const id of taskIds) delete awaiting[id];
    this.ctx.deps.db.setSetting(awaitingKey(projectId), awaiting);
  }

  async launchUnblocked(projectId: string, unblocked: string[]): Promise<void> {
    const awaiting = this.awaiting(projectId);
    const ready = unblocked.filter((id) => awaiting[id]);
    if (!ready.length) return;
    for (const id of ready) {
      const { message, assignment } = awaiting[id]!;
      delete awaiting[id];
      this.ctx.deps.db.setSetting(awaitingKey(projectId), awaiting);
      await this.launch(projectId, [id], message, assignment).catch(() => undefined);
    }
  }

  async start(projectId: string, taskId: string, input: MessageInput): Promise<void> {
    const artifacts = await this.ctx.project(projectId).load();
    const task = findTask(artifacts, taskId);
    if (task.archived) throw new Error('The task is archived');
    if (isBlocked(task, indexTasks(artifacts.tasks))) throw new Error('The task is blocked');
    const settings = this.ctx.views.settings(projectId, task, artifacts);
    await this.ctx.views.ensureAgent(settings.agent);
    await this.enqueue(projectId, taskId, input);
  }

  /** Whether the task's agent works now: its turn took a slot and has not ended. */
  holdsSlot(projectId: string, taskId: string): boolean {
    return this.ctx.queue.state().running.includes(key(projectId, taskId));
  }

  /**
   * Every turn of an agent takes a slot (architecture.md 7.1): the message waits in the queue
   * until one is free. Messages sent meanwhile join it and go to the agent in order. A task of a
   * stage also waits while another task of the stage works in their checkout.
   */
  async enqueue(projectId: string, taskId: string, input: MessageInput): Promise<void> {
    const k = key(projectId, taskId);
    await this.ctx.stages.sync(projectId, taskId);
    this.ctx.queuedInputs.set(k, [...(this.ctx.queuedInputs.get(k) ?? []), input]);
    this.ctx.queue.enqueue([k]);
    this.ctx.changed(projectId, taskId);
  }

  async begin(k: string): Promise<void> {
    const [projectId, taskId] = k.split('\n') as [string, string];
    const inputs = this.ctx.queuedInputs.get(k) ?? [{ text: '' }];
    this.ctx.queuedInputs.delete(k);
    const existing = this.ctx.active.get(k);
    if (existing) {
      this.ctx.setRuntime(projectId, taskId, 'running', existing.run.id);
      await this.ctx.stages.opened(existing);
      return this.runTurn(existing, inputs);
    }
    const active = await createTaskRun(this.ctx, projectId, taskId);
    this.ctx.setRuntime(projectId, taskId, 'running', active.run.id);
    this.ctx.deps.emit('project.changed', { projectId });
    await this.ctx.stages.opened(active);
    await this.ctx.stages.sync(projectId, taskId);
    return this.runTurn(active, inputs);
  }

  /** Holds the slot until the turn ends; later messages of the batch join the running turn. */
  private async runTurn(active: ActiveRun, inputs: MessageInput[]): Promise<void> {
    this.ctx.environments.touch(checkoutKey(active));
    const done = new Promise<void>((resolve) => (active.release = resolve));
    try {
      for (const input of inputs) await this.ctx.messages.deliver(active, input);
    } catch (error) {
      active.release = undefined;
      this.ctx.events.failTurn(active, error);
      throw error;
    }
    await done;
  }
}
