import { type TaskRuntime } from '@skaro/core';
import { persistsAfterTurn, type TimelineEvent } from '@skaro/timeline';
import { errorText } from './session-log';
import { FLUSH_MS } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';

/** events: a focused part of the task-run controller. */
export class TaskRunEvents {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  onEvent(active: ActiveRun, event: TimelineEvent): void {
    active.timeline.apply(event);
    active.seq++;
    active.pending.push(event);
    active.flushTimer ??= setTimeout(() => this.ctx.history.flush(active), FLUSH_MS);
    const { projectId, taskId } = active;
    switch (event.t) {
      case 'session.started':
        if (event.nativeSessionId && event.nativeSessionId !== active.run.nativeSessionId) {
          this.ctx.deps.db.setRunSession(active.run.id, event.nativeSessionId);
          active.run = { ...active.run, nativeSessionId: event.nativeSessionId };
        }
        return;
      case 'turn.started':
        this.ctx.setRuntime(projectId, taskId, 'running', active.run.id);
        return;
      case 'interaction.opened':
        // The merge card is "На ревью", not a question: it does not make the task wait.
        if (event.interaction.kind !== 'merge') {
          this.ctx.setRuntime(projectId, taskId, 'waiting', active.run.id);
          this.ctx.deps.db.addEvent(projectId, 'waiting', {
            task: taskId,
            what: event.interaction.kind,
            ...(event.interaction.kind === 'approval'
              ? { detail: event.interaction.action.title }
              : {}),
          });
          void this.ctx.notifyTask('need', projectId, taskId);
        }
        return;
      case 'interaction.closed':
        this.settleRuntime(active);
        return;
      case 'turn.completed':
        if (!event.continuing) void this.onTurnCompleted(active, event.outcome);
        return;
    }
  }

  async onTurnCompleted(
    active: ActiveRun,
    outcome: 'done' | 'interrupted' | 'failed',
  ): Promise<void> {
    this.settleRuntime(active);
    active.release?.();
    active.release = undefined;
    // The slot is free: environments of idle tasks beyond the limit stop now.
    this.ctx.limitEnvironments();
    const after = active.afterTurn;
    if (after) {
      active.afterTurn = undefined;
      await after().catch((error: unknown) =>
        this.ctx.history.notice(active, 'other', 'error', errorText(error)),
      );
      return;
    }
    const { projectId, taskId } = active;
    const context = this.ctx.project(projectId);
    try {
      const task = await context.store.readTask(taskId);
      if (task.status === 'done') return;
      const label = `${task.id} · ${task.title}`;
      if (outcome === 'failed') {
        // An error does not move the task back: it keeps its stage, the runtime says "failed".
        this.ctx.deps.db.addEvent(projectId, 'task_failed', { task: taskId });
        this.ctx.setRuntime(projectId, taskId, 'failed', active.run.id);
        this.ctx.deps.notify?.('error', label);
        this.ctx.results.statusChanged(projectId, taskId);
        return;
      }
      // The turn ended: "На ревью" only when every criterion is ticked, else the agent waits
      // for the user ("Нужен ответ", derived from "В работе" with no agent working).
      // Older task files may still hold the "failed" stage.
      if (task.status === 'failed')
        await context.store.updateTask(taskId, { status: 'in_progress' });
      const state = await this.ctx.results.criteriaChanged(projectId, taskId);
      if (state === 'open' || state === 'none') {
        this.ctx.deps.notify?.('need', label);
        this.ctx.results.statusChanged(projectId, taskId);
      }
    } catch {
      // The task file is gone or broken: the feed still works.
    }
    this.ctx.changed(projectId, taskId);
  }

  settleRuntime(active: ActiveRun): void {
    const s = active.timeline.state;
    const state: TaskRuntime = s.interactions.some((i) => i.kind !== 'merge')
      ? 'waiting'
      : s.status === 'idle'
        ? 'idle'
        : 'running';
    // After a failed turn the agent stays idle: "failed" holds until it works again.
    const current = this.ctx.deps.db.getTaskRuntime(active.projectId).get(active.taskId)?.state;
    if (state === 'idle' && current === 'failed') return;
    this.ctx.setRuntime(active.projectId, active.taskId, state, active.run.id);
  }

  failTurn(active: ActiveRun, error: unknown): void {
    const turn = active.timeline.state.turns.at(-1);
    if (turn && !turn.outcome) {
      for (const i of active.timeline.state.interactions) {
        if (!persistsAfterTurn(i))
          this.ctx.history.skaroEvent(active, {
            t: 'interaction.closed',
            id: i.id,
            resolution: 'expired',
          });
      }
      this.ctx.history.skaroEvent(active, {
        t: 'turn.completed',
        turnId: turn.id,
        outcome: 'failed',
        error: { category: 'other', message: errorText(error) },
      });
    } else {
      this.ctx.history.notice(active, 'other', 'error', errorText(error));
      this.settleRuntime(active);
      active.release?.();
      active.release = undefined;
    }
  }
}
