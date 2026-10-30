import { type TaskRuntime } from '@skaro/core';
import { currentActivity, persistsAfterTurn, type TimelineEvent } from '@skaro/timeline';
import { errorText } from './session-log';
import { FLUSH_MS, key } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { readSubject, updateSubject } from './task-subject';
import { awaitsDecision, waitCard } from './task-wait-card';

/** events: a focused part of the task-run controller. */
export class TaskRunEvents {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  onEvent(active: ActiveRun, event: TimelineEvent): void {
    event = active.secrets.redact(event);
    if (
      event.t === 'item.upsert' &&
      event.item.kind === 'message' &&
      event.item.role === 'user' &&
      active.internalInputs.has(event.item.text.trim())
    )
      return;
    if (this.ctx.active.get(`${active.projectId}\n${active.taskId}`) !== active) return;
    const affectsActivity =
      event.t === 'activity' ||
      event.t === 'status' ||
      event.t === 'turn.started' ||
      event.t === 'turn.completed' ||
      event.t === 'item.upsert';
    const beforeActivity = affectsActivity ? currentActivity(active.timeline.state) : undefined;
    active.timeline.apply(event);
    active.seq++;
    active.pending.push(event);
    active.flushTimer ??= setTimeout(() => this.ctx.history.flush(active), FLUSH_MS);
    if (active.switching) return;
    const { projectId, taskId } = active;
    // Text deltas repeat the same activity; reload the board only when its icon changes.
    if (affectsActivity && beforeActivity !== currentActivity(active.timeline.state))
      this.ctx.changed(projectId, taskId);
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
        if (!event.continuing) {
          const pending = this.onTurnCompleted(active, event.outcome);
          active.operations.add(pending);
          void pending.then(
            () => active.operations.delete(pending),
            (error: unknown) => {
              active.operations.delete(pending);
              this.ctx.history.notice(active, 'other', 'error', errorText(error));
            },
          );
        }
        return;
    }
  }

  /**
   * A finished turn that asked nothing through a card still waits for the owner: Skaro shows that
   * card itself, unless a proposal already asks, the owner wrote the next step or answered it.
   */
  showWaitCard(active: ActiveRun, body: string): void {
    const state = active.timeline.state;
    if (
      active.switching ||
      state.turns.at(-1)?.outcome !== 'done' ||
      state.turns.some((turn) => !turn.outcome) ||
      state.interactions.some((item) => item.kind === 'question') ||
      awaitsDecision(state) ||
      this.ctx.queuedInputs.get(key(active.projectId, active.taskId))?.length
    )
      return;
    const interaction = waitCard(active.run.id, body, state);
    if (state.items.some((item) => item.id === `skaro-decision-${interaction.id}`)) return;
    this.ctx.history.skaroEvent(active, { t: 'interaction.opened', interaction });
  }

  async onTurnCompleted(
    active: ActiveRun,
    outcome: 'done' | 'interrupted' | 'failed',
  ): Promise<void> {
    this.settleRuntime(active);
    if (active.timeline.state.interactions.some((i) => i.kind === 'question')) {
      active.release?.();
      active.release = undefined;
      this.ctx.queue.poke();
      return;
    }
    const after = active.afterTurn;
    try {
      if (after)
        await after().catch((error: unknown) =>
          this.ctx.history.notice(active, 'other', 'error', errorText(error)),
        );
    } finally {
      // Keep cleanup ownership through detach: releasing its slot may trigger another sweep.
      if (active.afterTurn === after) active.afterTurn = undefined;
      active.release?.();
      active.release = undefined;
      this.ctx.queue.poke();
      this.ctx.limitEnvironments();
    }
    if (after) return;
    const { projectId, taskId } = active;
    const context = this.ctx.project(projectId);
    try {
      const task = await readSubject(context, taskId);
      if (task.status === 'done') return;
      const label = `${task.id} · ${task.title}`;
      if (outcome === 'failed') {
        this.ctx.deps.db.addEvent(projectId, 'task_failed', { task: taskId });
        this.ctx.deps.notify?.('error', label);
        // An accepted result stays in review: the broken turn is in the feed, the task did not fail.
        if (task.status !== 'review') {
          // An error does not move the task back: it keeps its stage, the runtime says "failed".
          this.ctx.setRuntime(projectId, taskId, 'failed', active.run.id);
          this.ctx.results.statusChanged(projectId, taskId);
          return;
        }
      }
      // The turn ended: "На ревью" only when every criterion is ticked, else the agent waits
      // for the user ("Нужен ответ", derived from "В работе" with no agent working).
      // Older task files may still hold the "failed" stage.
      if (task.status === 'failed') await updateSubject(context, taskId, { status: 'in_progress' });
      // Acceptance is explicit (submit_result or the owner's criterion action). An ended or
      // interrupted turn must never commit new edits under a previous report's checked criteria.
      if (task.status === 'review') await this.ctx.stages.sync(projectId, taskId);
      else {
        if (outcome === 'done') this.showWaitCard(active, task.body);
        this.ctx.deps.notify?.('need', label);
        this.ctx.results.statusChanged(projectId, taskId);
      }
    } catch (error) {
      this.ctx.history.notice(active, 'other', 'error', errorText(error));
    }
    this.ctx.changed(projectId, taskId);
  }

  settleRuntime(active: ActiveRun): void {
    if (active.switching) return;
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
    if (active.switching) return;
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
