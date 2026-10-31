import { indexTasks, isBlocked, startBlocker } from '@skaro/core';
import { randomUUID } from 'node:crypto';
import { CommandCancelled } from './owner-commands';
import { hasOwnerCommand } from './owner-command-history';
import type { MessageInput, RunSlots, TaskAssignment } from '../shared/ipc';
import { createTaskRun } from './task-run-create';
import { checkoutKey, ownsCheckout } from './task-stage';
import { updateSubject } from './task-subject';
import { key, awaitingKey, findTask } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { errorText } from './session-log';
import { IntegrationPending } from './integration-model';
import { prepareTaskDependencies } from './task-dependency-checkout';
import { serializeTaskMutation } from './project-task-mutations';

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
    // A reused legacy id can have a retired run and an obsolete in_progress flag.
    for (const id of taskIds) await this.ctx.history.restore(projectId, id);
    for (const id of taskIds) {
      const context = this.ctx.project(projectId);
      const send = await serializeTaskMutation(context, async () => {
        const artifacts = await context.store.load();
        const task = findTask(artifacts, id);
        const blocker = startBlocker(task, indexTasks(artifacts.tasks));
        if (blocker === 'blocked') {
          const awaiting = this.awaiting(projectId);
          awaiting[id] = { message, ...(assignment ? { assignment } : {}) };
          this.ctx.deps.db.setSetting(awaitingKey(projectId), awaiting);
        }
        if (blocker) return false;
        const active = this.ctx.active.has(key(projectId, id));
        if (active && task.status !== 'todo') return false;
        if (assignment) await this.ctx.views.assign(projectId, id, assignment);
        if (
          task.status === 'todo' &&
          (active || this.ctx.deps.db.listRuns(projectId, id).length > 0)
        ) {
          await context.store.updateTask(id, { status: 'in_progress' });
          context.invalidate();
        }
        return true;
      });
      if (send) await this.ctx.messages.send(projectId, id, { text: message });
    }
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
    await this.ctx.reviews.stop(projectId, taskId);
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
      try {
        await this.launch(projectId, [id], message, assignment);
      } catch (error) {
        awaiting[id] = { message, ...(assignment ? { assignment } : {}) };
        this.ctx.deps.db.setSetting(awaitingKey(projectId), awaiting);
        this.ctx.setRuntime(projectId, id, 'failed');
        this.ctx.deps.db.addEvent(projectId, 'task_failed', { task: id, error: errorText(error) });
        this.ctx.deps.notify?.('error', `${id}: ${errorText(error)}`);
      }
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
    return serializeTaskMutation(this.ctx.project(projectId), () =>
      this.enqueueLocked(projectId, taskId, input),
    );
  }

  private async enqueueLocked(
    projectId: string,
    taskId: string,
    input: MessageInput,
  ): Promise<void> {
    // The task can have been replaced while agent setup was awaiting I/O.
    const task = findTask(await this.ctx.project(projectId).store.load(), taskId);
    const k = key(projectId, taskId);
    await this.ctx.stages.sync(projectId, taskId);
    const active = this.ctx.active.get(k);
    if (input.internal && input.commandId?.startsWith('continue-') && task.status !== 'in_progress')
      return;
    if (active && !this.ctx.continuation.canDeliver(active, input)) return;
    const accepted = { ...input, commandId: input.commandId ?? randomUUID() };
    this.ctx.startup.begin(projectId, taskId, [accepted]);
    this.ctx.queuedInputs.set(k, [...(this.ctx.queuedInputs.get(k) ?? []), accepted]);
    this.ctx.queue.enqueue([k]);
    this.ctx.changed(projectId, taskId);
  }

  async begin(k: string): Promise<void> {
    const [projectId, taskId] = k.split('\n') as [string, string];
    const inputs = this.ctx.startup.begin(projectId, taskId, this.ctx.queuedInputs.get(k) ?? []);
    this.ctx.queuedInputs.delete(k);
    const existing = await this.ctx.history.restore(projectId, taskId);
    if (existing) {
      if (!existing.run.nativeSessionId && !(await this.prepare(existing))) return;
      this.ctx.setRuntime(projectId, taskId, 'running', existing.run.id);
      await this.ctx.stages.opened(existing);
      return this.runTurn(existing, inputs);
    }
    const active = await createTaskRun(this.ctx, projectId, taskId);
    if (!(await this.prepare(active))) return;
    this.ctx.setRuntime(projectId, taskId, 'running', active.run.id);
    this.ctx.deps.emit('project.changed', { projectId });
    await this.ctx.stages.opened(active);
    await this.ctx.stages.sync(projectId, taskId);
    return this.runTurn(active, inputs);
  }

  private async prepare(active: ActiveRun): Promise<boolean> {
    if (!active.run.worktree) return true;
    const artifacts = await this.ctx.project(active.projectId).load();
    try {
      await prepareTaskDependencies(
        this.ctx,
        active.projectId,
        findTask(artifacts, active.taskId),
        artifacts,
        active.run.worktree,
      );
      return true;
    } catch (error) {
      if (error instanceof IntegrationPending) return false;
      throw error;
    }
  }

  /** Holds the slot until the turn ends; later messages of the batch join the running turn. */
  private async runTurn(active: ActiveRun, inputs: MessageInput[]): Promise<void> {
    inputs = inputs.filter((input) => !hasOwnerCommand(active.timeline.state, input.commandId));
    if (!inputs.length) {
      this.ctx.startup.delivered(active.projectId, active.taskId);
      this.ctx.events.settleRuntime(active);
      return;
    }
    this.ctx.environments.touch(checkoutKey(active));
    const done = new Promise<void>((resolve) => (active.release = resolve));
    try {
      for (const input of inputs) await this.ctx.messages.deliver(active, input);
      this.ctx.startup.delivered(active.projectId, active.taskId);
    } catch (error) {
      if (error instanceof CommandCancelled) {
        this.ctx.startup.delivered(active.projectId, active.taskId);
        active.release?.();
        active.release = undefined;
        this.ctx.setRuntime(active.projectId, active.taskId, 'idle', active.run.id);
        return;
      }
      active.release = undefined;
      this.ctx.events.failTurn(active, error);
      throw error;
    }
    await done;
  }
}
