import type { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { persistsAfterTurn } from '@skaro/timeline';
import { key } from './task-run-helpers';

interface SuspensionCheckpoint {
  state: 'suspending' | 'suspended' | 'failed';
  nativeSessionId?: string;
  intent: number;
  at: number;
}

/** A checkpoint is not an owner stop: keep intent and durable questions, retire only the idle runtime. */
export async function suspendWaitingTask(
  ctx: TaskRunEngine,
  active: ActiveRun,
  retry = false,
): Promise<void> {
  if (active.suspending) return active.suspending;
  const { projectId, taskId, run, deliveryEpoch, stopError } = active;
  const state = active.timeline.state;
  const execution = ctx.continuation.execution(active);
  const waiting = !!execution.read().blocked || state.interactions.some(persistsAfterTurn);
  if (
    !waiting ||
    ctx.closing ||
    active.switching ||
    active.stopping ||
    active.attaching ||
    active.inputTransition ||
    active.afterTurn ||
    state.turns.some((t) => !t.outcome) ||
    ctx.queuedInputs.get(key(projectId, taskId))?.length
  )
    return;

  const checkpointKey = `run.${run.id}.suspension`;
  const intent = execution.intentVersion();
  if (retry) {
    const saved = ctx.deps.db.getSetting<SuspensionCheckpoint | null>(checkpointKey, null);
    if (
      active.session ||
      !saved ||
      saved.state === 'suspended' ||
      saved.nativeSessionId !== run.nativeSessionId ||
      saved.intent !== intent
    )
      return;
  } else if (stopError || (!active.session && !active.builtinAdmission)) return;

  const work = async () => {
    ctx.history.flush(active);
    const save = (state: SuspensionCheckpoint['state']) =>
      ctx.deps.db.setSetting(checkpointKey, {
        nativeSessionId: run.nativeSessionId,
        intent,
        at: Date.now(),
        state,
      } satisfies SuspensionCheckpoint);
    save('suspending');
    try {
      await ctx.sessions.detach(active);
    } catch (error) {
      save('failed');
      throw error;
    }
    if (
      retry &&
      !active.stopping &&
      active.deliveryEpoch === deliveryEpoch &&
      active.stopError === stopError &&
      execution.intentVersion() === intent
    )
      active.stopError = undefined;
    save('suspended');
    ctx.deps.db.addEvent(projectId, 'task_runtime_suspended', {
      task: taskId,
      run: run.id,
    });
    ctx.limitEnvironments();
  };
  active.suspending = work().finally(() => {
    active.suspending = undefined;
  });
  await active.suspending;
}

/** An unanswered question can retry its own checkpoint after the worker has gone away. */
export async function recoverWaitingTaskSuspension(ctx: TaskRunEngine, active: ActiveRun) {
  if (active.suspending) {
    try {
      await active.suspending;
      return;
    } catch {
      // The failed checkpoint keeps ownership of any processes that still need to be stopped.
    }
  }
  await suspendWaitingTask(ctx, active, true);
}
