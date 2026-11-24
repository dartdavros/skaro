import { operationTimeout } from '@skaro/timeline';
import {
  blockOwnerMessages,
  CommandCancelled,
  confirmOwnerMessagesStopped,
} from './owner-commands';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import { shutdownTaskRuntime } from './task-runtime-shutdown';

/** Stop retires the transport and its grants; a later input must obtain a fresh admission. */
export function stopBuiltinTask(
  ctx: TaskRunEngine,
  active: ActiveRun,
  commands: string[] = [],
): Promise<void> {
  if (active.stopping) return active.stopping;
  const { projectId, taskId } = active;
  const unblock = blockOwnerMessages(projectId, taskId, 'Task is stopping. Wait for confirmation.');
  const work = (async () => {
    try {
      await shutdownTaskRuntime(ctx, active);
      await operationTimeout(
        confirmOwnerMessagesStopped(projectId, taskId, commands, {
          kind: 'run',
          id: active.run.id,
          version: active.deliveryEpoch,
        }),
        15_000,
        'Interrupted message delivery has not settled',
      );
      for (const interaction of [...active.timeline.state.interactions])
        if (['approval', 'question', 'form', 'login'].includes(interaction.kind))
          ctx.history.skaroEvent(active, {
            t: 'interaction.closed',
            id: interaction.id,
            resolution: 'expired',
          });
      for (const turn of active.timeline.state.turns.filter((turn) => !turn.outcome))
        ctx.history.skaroEvent(active, {
          t: 'turn.completed',
          turnId: turn.id,
          outcome: 'interrupted',
        });
      active.stopError = undefined;
      ctx.events.settleRuntime(active);
    } catch (error) {
      active.stopError = error instanceof Error ? error.message : 'Task shutdown was not confirmed';
      throw error;
    } finally {
      ctx.history.flush(active);
      ctx.changed(projectId, taskId);
      unblock();
    }
  })();
  active.stopping = work.finally(() => {
    active.stopping = undefined;
  });
  return active.stopping;
}

export function requireTaskNotStopping(active: Pick<ActiveRun, 'stopping' | 'stopError'>): void {
  if (active.stopError) throw new Error(active.stopError);
  if (active.stopping) throw new CommandCancelled();
}
