import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  persistsAfterTurn,
  countSegments,
  replayRunLog,
  Timeline,
  type RawLine,
  type TimelineEvent,
} from '@skaro/timeline';
import { projectorFor, readRunLog } from './session-log';
import { key } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';

/** history: a focused part of the task-run controller. */
export class TaskRunHistory {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  async restore(projectId: string, taskId: string): Promise<ActiveRun | undefined> {
    const k = key(projectId, taskId);
    const existing = this.ctx.active.get(k);
    if (existing) return existing;
    const run = this.ctx.deps.db.listRuns(projectId, taskId)[0];
    if (!run) return undefined;
    const lines = await readRunLog(join(this.ctx.deps.dataDir, run.logPath));
    const again = this.ctx.active.get(k);
    if (again) return again;
    const events = replayRunLog(lines, run.startedAt, projectorFor(run.agent), (image) =>
      this.ctx.deps.attachments.save(image),
    );
    const active = new ActiveRun(projectId, taskId, run, Timeline.from(events));
    active.seq = events.length;
    active.segments = countSegments(lines);
    this.ctx.active.set(k, active);
    // A live turn cannot survive a restart; async questions still wait for a later reply.
    const turn = active.timeline.state.turns.at(-1);
    if (turn && !turn.outcome) {
      for (const i of active.timeline.state.interactions) {
        if (!persistsAfterTurn(i))
          this.skaroEvent(active, { t: 'interaction.closed', id: i.id, resolution: 'expired' });
      }
      this.skaroEvent(active, { t: 'turn.completed', turnId: turn.id, outcome: 'interrupted' });
    }
    this.ctx.events.settleRuntime(active);
    return active;
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

  writeLine(active: ActiveRun, line: RawLine): void {
    if (!active.log) {
      const path = join(this.ctx.deps.dataDir, active.run.logPath);
      mkdirSync(dirname(path), { recursive: true });
      const log = createWriteStream(path, { flags: 'a' });
      // A failing disk must not take the app down; the live feed keeps working.
      log.on('error', (error) => console.error(`run log ${path}: ${error.message}`));
      active.log = log;
    }
    active.log.write(`${JSON.stringify(line)}\n`);
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
      events,
    });
  }
}
