import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { continuationTimeline } from '@skaro/timeline';
import type { MessageInput } from '../shared/ipc';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { key, settingsKey } from './task-run-helpers';
import { handoffContext } from './task-history-context';
import { loadTaskHistory } from './task-history-load';
import type { TimelineState } from '@skaro/timeline';
import { errorText } from './session-log';
import {
  handoffAgentName,
  prepareTaskHandoff,
  type TaskHandoffSettings,
} from './task-handoff-settings';
import { handoffInputs } from './task-handoff-inputs';
import { parseBuiltinTaskStart, type BuiltinTaskHandoffRequest } from './builtin-task-start';
import { saveBuiltinRunSettings } from './builtin-run-settings';
import { TaskExecution } from './task-execution';
import { CommandCancelled } from './owner-commands';
import { requireTaskNotStopping } from './builtin-task-stop';
import { restoreCleanedWorktree } from './task-worktree-retention';

interface Intent {
  from: string;
  next: TaskHandoffSettings;
  inputs: MessageInput[];
  interactions: TimelineState['interactions'];
  plan?: TimelineState['plan'];
}

/** One task keeps its checkout; each provider gets its own native session and immutable log. */
export class TaskRunHandoff {
  private readonly pending = new Map<string, Promise<ActiveRun>>();
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  blocked(k: string): boolean {
    return this.pending.has(k) || this.ctx.active.get(k)?.switching === true;
  }

  changing(active: ActiveRun | undefined): boolean {
    return !!active && this.pending.has(key(active.projectId, active.taskId));
  }

  async recover(active: ActiveRun, strict = true, queuedRecovery = false): Promise<ActiveRun> {
    const intent = this.ctx.deps.db.getSetting<Intent | null>(
      `${settingsKey(active.projectId, active.taskId)}.handoff`,
      null,
    );
    if (intent?.from !== active.run.id) return active;
    try {
      return await this.change(active, intent.next, queuedRecovery);
    } catch (error) {
      if (strict) throw error;
      const message = errorText(error);
      if (active.handoffError !== message) {
        active.handoffError = message;
        this.ctx.history.notice(active, 'other', 'error', message);
      }
      return active;
    }
  }

  async changeBuiltin(request: BuiltinTaskHandoffRequest): Promise<void> {
    const { projectId, taskId, signal } = request;
    signal.throwIfAborted();
    const epoch = this.ctx.startup.cancellationEpoch(projectId, taskId);
    const active = await this.ctx.history.restore(projectId, taskId);
    if (!active) throw new Error('Builtin handoff requires an existing task run');
    if (!this.ctx.deps.builtinSessions)
      throw new Error('Builtin task authorization is unavailable');
    const settings = await this.ctx.deps.builtinSessions.resolveStart(request.settings, signal);
    signal.throwIfAborted();
    if (epoch !== this.ctx.startup.cancellationEpoch(projectId, taskId))
      throw new CommandCancelled();
    await this.change(active, settings);
  }

  change(active: ActiveRun, next: TaskHandoffSettings, queuedRecovery = false): Promise<ActiveRun> {
    try {
      requireTaskNotStopping(active);
    } catch (error) {
      return Promise.reject(error);
    }
    const k = key(active.projectId, active.taskId);
    const pending = this.pending.get(k);
    if (pending) return pending;
    if (
      active.timeline.state.status === 'working' ||
      active.attaching ||
      (!queuedRecovery && this.ctx.scheduling.holdsSlot(active.projectId, active.taskId))
    )
      return Promise.reject(new Error('Stop the current turn before changing the agent.'));
    active.switching = true;
    const operation = this.perform(active, structuredClone(next)).finally(() => {
      this.pending.delete(k);
      this.ctx.queue.poke();
    });
    this.pending.set(k, operation);
    return operation;
  }

  private async perform(active: ActiveRun, next: TaskHandoffSettings): Promise<ActiveRun> {
    const { projectId, taskId } = active;
    const k = key(projectId, taskId);
    const setting = settingsKey(projectId, taskId);
    const intentKey = `${setting}.handoff`;
    const db = this.ctx.deps.db;
    let intent = db.getSetting<Intent | null>(intentKey, null);
    try {
      if (intent && intent.from !== active.run.id)
        throw new Error('The handoff intent belongs to another run');
      const fromName = handoffAgentName(active.run.agent);
      const toName = handoffAgentName(next.agent);
      await prepareTaskHandoff(this.ctx, active, next, new AbortController().signal);
      // Work admitted before the handoff may finish; later requests are rejected.
      await Promise.allSettled([...active.operations]);
      await this.ctx.merges.idle(projectId);
      if (active.afterTurn) throw new Error('Wait for the merge cleanup to finish.');
      if (!intent) {
        intent = {
          from: active.run.id,
          next,
          inputs: handoffInputs(
            this.ctx.startup.read(projectId, taskId)?.inputs ?? [],
            this.ctx.queuedInputs.get(k) ?? [],
          ),
          interactions: structuredClone(active.timeline.state.interactions),
          ...(active.timeline.state.plan
            ? { plan: structuredClone(active.timeline.state.plan) }
            : {}),
        };
        db.setSetting(intentKey, intent);
      } else {
        intent = { ...intent, next };
        db.setSetting(intentKey, intent);
      }
      next = intent.next;
      // Await actual shutdown. No swallowed close error and no replacement writer on timeout.
      await this.ctx.sessions.stopForHandoff(active);
      await restoreCleanedWorktree(this.ctx, active.run);
      await this.ctx.history.drain(active);
      const recorded = await loadTaskHistory(this.ctx.deps, active.run);
      const context = await handoffContext(this.ctx, active, {
        ...recorded.timeline.state,
        interactions: intent.interactions,
        ...(intent.plan ? { plan: intent.plan } : {}),
      });
      const handoff = JSON.stringify({
        context,
        mergeSummary: active.mergeSummary,
        commitMessage: active.commitMessage,
        inputs: intent.inputs,
      });
      // Metadata or task identity may have changed while the old process was closing.
      const prepared = await prepareTaskHandoff(
        this.ctx,
        active,
        next,
        new AbortController().signal,
      );
      const saved = prepared.settings;
      const execution = this.ctx.continuation.execution(active).read();
      const run = db.continueRun(
        {
          projectId,
          taskId,
          agent: saved.agent,
          ...(saved.model ? { model: saved.model } : {}),
          ...(active.run.worktree ? { worktree: active.run.worktree } : {}),
          ...(active.run.branch ? { branch: active.run.branch } : {}),
          logPath: join('runs', projectId, taskId, `${Date.now()}-${randomUUID()}.jsonl`),
          adapterVersion: prepared.adapterVersion,
          previousRunId: active.run.id,
          handoff,
        },
        setting,
        saved.agent === 'skaro' ? db.getSetting(setting, null) : saved,
        (run) => {
          if (saved.agent === 'skaro')
            saveBuiltinRunSettings(db, run.id, parseBuiltinTaskStart(saved));
          new TaskExecution(db, run.id).inherit(execution);
          this.ctx.startup.delivered(projectId, taskId);
          if (intent!.inputs.length) {
            if (saved.agent === 'skaro')
              this.ctx.startup.selectBuiltin(projectId, taskId, parseBuiltinTaskStart(saved));
            this.ctx.startup.begin(projectId, taskId, intent!.inputs);
          }
        },
      );
      const successor = new ActiveRun(
        projectId,
        taskId,
        run,
        continuationTimeline(recorded.timeline.state),
      );
      successor.seq = recorded.seq;
      successor.mergeSummary = active.mergeSummary;
      successor.commitMessage = active.commitMessage;
      this.ctx.active.set(k, successor);
      active.log?.end();
      this.ctx.history.notice(
        successor,
        'other',
        'info',
        this.ctx.deps.locale() === 'ru'
          ? `Агент изменён: ${fromName} → ${toName}. Работа продолжится со следующего сообщения.`
          : `Agent changed: ${fromName} → ${toName}. Work continues with the next message.`,
      );
      await this.ctx.history.drain(successor);
      this.ctx.setRuntime(projectId, taskId, 'idle', run.id);
      this.ctx.merges.watch(successor);
      if (intent.inputs.length) {
        this.ctx.queuedInputs.set(k, intent.inputs);
        this.ctx.queue.enqueue([k]);
      } else this.ctx.queuedInputs.delete(k);
      active.release?.();
      active.release = undefined;
      this.ctx.changed(projectId, taskId);
      return successor;
    } catch (error) {
      // The intent keeps an interrupted handoff recoverable. Without it the old session is intact.
      if (!db.getSetting(intentKey, null)) active.switching = false;
      if (this.ctx.active.get(k) !== active) {
        active.release?.();
        active.release = undefined;
      }
      throw error;
    }
  }
}
