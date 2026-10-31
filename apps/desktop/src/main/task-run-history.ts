import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { persistsAfterTurn, type RawLine, type TimelineEvent } from '@skaro/timeline';
import { loadTaskHistory } from './task-history-load';
import { key, settingsKey } from './task-run-helpers';
import { handoffRecord } from './task-handoff-record';
import { CompletionStore } from './completion-store';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { QuestionAnswers } from './question-answers';
import { presentationEvent } from './timeline-presentation';
import { isLegacyWaitCard } from './task-wait-card';

/** history: a focused part of the task-run controller. */
export class TaskRunHistory {
  private readonly ctx: TaskRunEngine;
  private readonly restoring = new Map<string, Promise<ActiveRun | undefined>>();
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  restore(projectId: string, taskId: string): Promise<ActiveRun | undefined> {
    const k = key(projectId, taskId);
    const pending = this.restoring.get(k);
    if (pending) return pending;
    const restored = this.restoreOnce(projectId, taskId).finally(() => this.restoring.delete(k));
    this.restoring.set(k, restored);
    return restored;
  }

  private async restoreOnce(projectId: string, taskId: string): Promise<ActiveRun | undefined> {
    const k = key(projectId, taskId);
    let existing = this.ctx.active.get(k);
    if (existing && this.ctx.deps.db.getRun(existing.run.id)?.retiredAt !== undefined) {
      existing.switching = true;
      await this.ctx.sessions.detach(existing);
      existing.log?.end();
      this.ctx.active.delete(k);
      this.ctx.queuedInputs.delete(k);
      this.ctx.setRuntime(projectId, taskId, 'idle');
      existing = undefined;
    }
    if (existing) return existing;
    const run = this.ctx.deps.db.listRuns(projectId, taskId)[0];
    if (!run) {
      const retired = this.ctx.deps.db.listRuns(projectId, taskId, { includeRetired: true });
      if (retired.length) {
        const context = this.ctx.project(projectId);
        const task = (await context.load()).tasks.find((task) => task.id === taskId);
        if (task?.status === 'in_progress') {
          await context.store.updateTask(taskId, { status: 'todo' });
          context.invalidate();
          this.ctx.changed(projectId, taskId);
        }
      }
      return undefined;
    }
    const restored = await loadTaskHistory(this.ctx.deps, run);
    const again = this.ctx.active.get(k);
    if (again) return again;
    const active = new ActiveRun(projectId, taskId, run, restored.timeline);
    active.seq = restored.seq;
    active.segments = restored.segments;
    const handoff = handoffRecord(run);
    const result = new CompletionStore(this.ctx.deps.db, projectId).result(taskId);
    active.mergeSummary = handoff?.mergeSummary ?? result?.summary;
    active.commitMessage = handoff?.commitMessage ?? result?.message;
    active.verification = result?.verification;
    this.ctx.active.set(k, active);
    // Generic wait cards never represented an owner decision; do not restore their tool barrier.
    for (const interaction of [...active.timeline.state.interactions])
      if (isLegacyWaitCard(interaction))
        this.skaroEvent(active, {
          t: 'interaction.closed',
          id: interaction.id,
          resolution: 'cancelled',
        });
    // A live turn cannot survive a restart; async questions still wait for a later reply.
    const turn = active.timeline.state.turns.at(-1);
    if (turn && !turn.outcome) {
      // Recovery records an interruption; it must not trigger acceptance or auto-merge.
      active.switching = true;
      for (const i of active.timeline.state.interactions) {
        if (!persistsAfterTurn(i))
          this.skaroEvent(active, { t: 'interaction.closed', id: i.id, resolution: 'expired' });
      }
      this.skaroEvent(active, { t: 'turn.completed', turnId: turn.id, outcome: 'interrupted' });
      active.switching = false;
    }
    active.switching = !!this.ctx.deps.db.getSetting(
      `${settingsKey(projectId, taskId)}.handoff`,
      null,
    );
    this.ctx.events.settleRuntime(active);
    const answers = new QuestionAnswers(this.ctx.deps.db, `active.${run.id}`);
    answers.recover(active.timeline.state, (event) => this.skaroEvent(active, event));
    answers.queue('task.send', projectId, taskId, active.timeline.state);
    return active;
  }

  async drain(active: ActiveRun): Promise<void> {
    if (!active.log)
      this.writeLine(active, {
        ts: Date.now() - active.run.startedAt,
        dir: 'meta',
        line: { event: 'handoff-checkpoint' },
      });
    if (active.log)
      await new Promise<void>((resolve, reject) => {
        active.log!.write('', (error) => (error ? reject(error) : resolve()));
      });
    this.flush(active);
  }

  skaroEvent(active: ActiveRun, event: TimelineEvent): void {
    this.writeLine(active, {
      ts: Date.now() - active.run.startedAt,
      dir: 'meta',
      line: { skaro: 'event', event },
    });
    this.ctx.events.onEvent(active, event);
  }

  notice(
    active: ActiveRun,
    code: 'session_restored' | 'session_lost' | 'other',
    level: 'info' | 'error',
    text: string,
  ): void {
    this.skaroEvent(active, {
      t: 'item.upsert',
      item: {
        id: `skaro-${code}-${randomUUID()}`,
        turnId: active.timeline.state.turns.at(-1)?.id ?? '',
        kind: 'notice',
        level,
        code,
        text,
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: code, ref: '' },
      },
    });
  }

  writeLine(active: ActiveRun, line: RawLine | Uint8Array): void {
    if (!(line instanceof Uint8Array)) line = active.secrets.redact(line);
    if (!active.log) {
      const path = join(this.ctx.deps.dataDir, active.run.logPath);
      mkdirSync(dirname(path), { recursive: true });
      const log = createWriteStream(path, { flags: 'a' });
      // A failing disk must not take the app down; the live feed keeps working.
      log.on('error', (error) => console.error(`run log ${path}: ${error.message}`));
      active.log = log;
    }
    active.log.write(line instanceof Uint8Array ? line : `${JSON.stringify(line)}\n`);
  }

  flush(active: ActiveRun): void {
    clearTimeout(active.flushTimer);
    active.flushTimer = undefined;
    if (!active.pending.length) return;
    const events = active.pending;
    active.pending = [];
    this.ctx.deps.emit('task.events', {
      projectId: active.projectId,
      taskId: active.taskId,
      runId: active.run.id,
      seq: active.seq - events.length,
      events: events.map(presentationEvent),
    });
  }
}
