import type { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { persistsAfterTurn } from '@skaro/timeline';

/** A checkpoint is not an owner stop: keep intent and durable questions, retire only the idle runtime. */
export async function suspendWaitingTask(ctx: TaskRunEngine, active: ActiveRun): Promise<void> {
  if (active.suspending) return active.suspending;
  const state = active.timeline.state;
  const waiting =
    !!ctx.continuation.execution(active).read().blocked ||
    state.interactions.some(persistsAfterTurn);
  if (
    !waiting ||
    ctx.closing ||
    active.switching ||
    active.stopping ||
    active.attaching ||
    active.afterTurn ||
    state.turns.some((t) => !t.outcome) ||
    ctx.queuedInputs.get(`${active.projectId}\n${active.taskId}`)?.length
  )
    return;
  if (!active.session && !active.builtinAdmission) return;
  const work = async () => {
    ctx.history.flush(active);
    const checkpoint = {
      nativeSessionId: active.run.nativeSessionId,
      intent: ctx.continuation.execution(active).intentVersion(),
      at: Date.now(),
    };
    const key = `run.${active.run.id}.suspension`;
    ctx.deps.db.setSetting(key, { ...checkpoint, state: 'suspending' });
    try {
      await ctx.sessions.detach(active);
    } catch (error) {
      ctx.deps.db.setSetting(key, { ...checkpoint, state: 'failed', at: Date.now() });
      throw error;
    }
    ctx.deps.db.setSetting(key, { ...checkpoint, state: 'suspended', at: Date.now() });
    ctx.deps.db.addEvent(active.projectId, 'task_runtime_suspended', {
      task: active.taskId,
      run: active.run.id,
    });
    ctx.limitEnvironments();
  };
  active.suspending = work().finally(() => {
    active.suspending = undefined;
  });
  await active.suspending;
}
