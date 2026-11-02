import { indexTasks, isBlocked, startBlocker } from '@skaro/core';
import { randomUUID } from 'node:crypto';
import { CommandCancelled } from './owner-commands';
import { hasOwnerCommand } from './owner-command-history';
import type { MessageInput, RunSlots, TaskAssignment } from '../shared/ipc';
import { createTaskRun } from './task-run-create';
import { checkoutKey } from './task-stage';
import { key, awaitingKey, findTask } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { errorText } from './session-log';
import { IntegrationPending } from './integration-model';
import { prepareTaskDependencies } from './task-dependency-checkout';
import { serializeTaskMutation } from './project-task-mutations';
import { queueBuiltinTask } from './builtin-task-launch';
import type { BuiltinTaskLaunchRequest } from './builtin-task-start';
import { capturePendingBuiltinStart } from './builtin-task-pending';
import { cancelTaskRun } from './task-run-cancel';

/** scheduling: a focused part of the task-run controller. */
export class TaskRunScheduling {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }
  launchBuiltin(request: BuiltinTaskLaunchRequest): Promise<void> {
    return queueBuiltinTask(this.ctx, request, (input, requireCurrent) =>
      this.enqueueLocked(request.projectId, request.taskId, input, requireCurrent),
    );
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
    return cancelTaskRun(this.ctx, projectId, taskId);
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
    requireCurrent?: () => void,
  ): Promise<void> {
    // The task can have been replaced while agent setup was awaiting I/O.
    const task = findTask(await this.ctx.project(projectId).store.load(), taskId);
    requireCurrent?.();
    const k = key(projectId, taskId);
    await this.ctx.stages.sync(projectId, taskId);
    requireCurrent?.();
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
    try {
      await this.beginCurrent(projectId, taskId, k);
    } catch (error) {
      if (!(error instanceof CommandCancelled)) throw error;
      this.ctx.setRuntime(projectId, taskId, 'idle');
    }
  }

  private async beginCurrent(projectId: string, taskId: string, k: string): Promise<void> {
    const pending = this.ctx.startup.read(projectId, taskId);
    if (!pending?.inputs.length && !this.ctx.queuedInputs.get(k)?.length) {
      this.ctx.setRuntime(projectId, taskId, 'idle');
      return;
    }
    const requireCurrent = pending?.builtin
      ? capturePendingBuiltinStart(this.ctx.startup, projectId, taskId, () => this.ctx.closing)
      : undefined;
    const inputs = this.ctx.startup.begin(projectId, taskId, this.ctx.queuedInputs.get(k) ?? []);
    this.ctx.queuedInputs.delete(k);
    const builtin = this.ctx.startup.read(projectId, taskId)?.builtin;
    const existing = await this.ctx.history.restore(projectId, taskId);
    requireCurrent?.();
    if (existing && builtin && existing.run.agent !== 'skaro')
      throw new Error('Pending builtin launch conflicts with the existing task run');
    if (existing) {
      if (!existing.run.nativeSessionId && !(await this.prepare(existing))) return;
      requireCurrent?.();
      this.ctx.setRuntime(projectId, taskId, 'running', existing.run.id);
      await this.ctx.stages.opened(existing);
      requireCurrent?.();
      return this.runTurn(existing, inputs);
    }
    const active = await createTaskRun(this.ctx, projectId, taskId, builtin, requireCurrent);
    if (!(await this.prepare(active))) return;
    requireCurrent?.();
    this.ctx.setRuntime(projectId, taskId, 'running', active.run.id);
    this.ctx.deps.emit('project.changed', { projectId });
    await this.ctx.stages.opened(active);
    await this.ctx.stages.sync(projectId, taskId);
    requireCurrent?.();
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
    const epoch = active.deliveryEpoch;
    inputs = inputs.filter((input) => !hasOwnerCommand(active.timeline.state, input.commandId));
    if (!inputs.length) {
      this.ctx.startup.delivered(active.projectId, active.taskId);
      this.ctx.events.settleRuntime(active);
      return;
    }
    this.ctx.environments.touch(checkoutKey(active));
    const done = new Promise<void>((resolve) => (active.release = resolve));
    try {
      for (const input of inputs) {
        if (active.deliveryEpoch !== epoch || this.ctx.closing) throw new CommandCancelled();
        await this.ctx.messages.deliver(active, input);
      }
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
