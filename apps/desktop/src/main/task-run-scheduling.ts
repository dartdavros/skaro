import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { indexTasks, isBlocked, startBlocker, taskBranch } from '@skaro/core';
import { Timeline } from '@skaro/timeline';
import type { MessageInput, RunSlots, TaskAssignment } from '../shared/ipc';
import { prepareTaskWorktree } from './task-worktree';
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
      if (this.ctx.active.has(key(projectId, id)) || blocker) continue;
      if (assignment) await this.ctx.views.assign(projectId, id, assignment);
      await this.ctx.messages.send(projectId, id, { text: message });
    }
    this.ctx.deps.db.setSetting(awaitingKey(projectId), awaiting);
  }

  awaiting(projectId: string): Record<string, { message: string; assignment?: TaskAssignment }> {
    return this.ctx.deps.db.getSetting(awaitingKey(projectId), {}) ?? {};
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
    const k = key(projectId, taskId);
    this.ctx.firstInputs.set(k, input);
    const result = this.ctx.queue.enqueue([k]);
    if (!result.accepted.length) this.ctx.firstInputs.delete(k);
    this.ctx.changed(projectId, taskId);
  }

  async begin(k: string): Promise<void> {
    const [projectId, taskId] = k.split('\n') as [string, string];
    const input = this.ctx.firstInputs.get(k) ?? { text: '' };
    this.ctx.firstInputs.delete(k);
    const context = this.ctx.project(projectId);
    const artifacts = await context.load();
    const task = findTask(artifacts, taskId);
    const settings = this.ctx.views.settings(projectId, task, artifacts);

    let worktree: string | undefined;
    let branch: string | undefined;
    if (settings.isolation === 'worktree') {
      branch = task.branch ?? taskBranch(artifacts.config, task);
      worktree = await prepareTaskWorktree({
        git: context.git,
        dataDir: this.ctx.deps.dataDir,
        projectId,
        taskId,
        branch,
        base: artifacts.config.baseBranch,
      });
    }
    await context.store.updateTask(taskId, {
      status: 'in_progress',
      ...(branch ? { branch } : {}),
    });
    context.invalidate();

    const logPath = join(
      'runs',
      projectId,
      taskId,
      `${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`,
    );
    const adapter = this.ctx.deps.agents.adapter(settings.agent);
    const run = this.ctx.deps.db.createRun({
      projectId,
      taskId,
      agent: settings.agent,
      ...(settings.model ? { model: settings.model } : {}),
      ...(worktree ? { worktree } : {}),
      ...(branch ? { branch } : {}),
      logPath,
      adapterVersion: adapter.adapterVersion,
    });
    const active = new ActiveRun(projectId, taskId, run, new Timeline());
    this.ctx.active.set(k, active);
    this.ctx.setRuntime(projectId, taskId, 'running', run.id);
    this.ctx.deps.emit('project.changed', { projectId });

    const done = new Promise<void>((resolve) => (active.release = resolve));
    try {
      await this.ctx.messages.deliver(active, input);
    } catch (error) {
      active.release = undefined;
      this.ctx.events.failTurn(active, error);
      throw error;
    }
    await done;
  }
}
