import { operationTimeout } from '@skaro/timeline';
import { blockOwnerMessages, CommandCancelled } from './owner-commands';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import { key } from './task-run-helpers';

/** Stop retires the transport and its grants; a later input must obtain a fresh admission. */
export function stopBuiltinTask(ctx: TaskRunEngine, active: ActiveRun): Promise<void> {
  if (active.stopping) return active.stopping;
  const { projectId, taskId } = active;
  const unblock = blockOwnerMessages(projectId, taskId, 'Task is stopping. Wait for confirmation.');
  const work = (async () => {
    try {
      await ctx.integrations.controls.interrupt(projectId, taskId);
      ctx.queue.cancel(key(projectId, taskId));
      const session = active.session;
      if (session) {
        try {
          await operationTimeout(session.interrupt(), 5000, 'Native interrupt deadline exceeded');
        } catch {
          // Teardown below still requires verified process exit; a timeout is not success.
          ctx.deps.db.addEvent(projectId, 'task_interrupt_escalated', { task: taskId });
        }
      }
      await ctx.sessions.detach(active);
      await active.pumping;
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
