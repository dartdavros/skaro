import { randomUUID } from 'node:crypto';
import { operationTimeout } from '@skaro/timeline';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import {
  blockOwnerMessages,
  confirmOwnerMessagesStopped,
  stopOwnerMessages,
} from './owner-commands';
import { shutdownTaskRuntime } from './task-runtime-shutdown';
import { taskStopDeliveries } from './task-stop-deliveries';

/** The native Stop keeps durable shared decisions, but retires its writer before a fresh intent. */
export function stopManagedTask(
  ctx: TaskRunEngine,
  active: ActiveRun,
  commands: string[],
  integrationOwnsDelivery = false,
) {
  if (active.stopping) return active.stopping;
  const { projectId, taskId } = active;
  const unblock = blockOwnerMessages(projectId, taskId, 'Task is stopping. Wait for confirmation.');
  const receipt = `native.task-stop.${active.run.id}`,
    requestId = randomUUID();
  const captured = taskStopDeliveries(
    ctx.deps.db,
    projectId,
    taskId,
    [...new Set([...commands, ...stopOwnerMessages(projectId, taskId)])],
    integrationOwnsDelivery,
  );
  const record = (state: string, runs?: string[]) =>
    ctx.deps.db.setSetting(receipt, {
      version: 1,
      requestId,
      state,
      epoch: active.deliveryEpoch,
      at: Date.now(),
      ...(runs ? { runs } : {}),
    });
  const work = (async () => {
    try {
      record('requested');
      await shutdownTaskRuntime(ctx, active);
      const runs = ctx.deps.db.listRuns(projectId, taskId, { includeRetired: true });
      for (const run of runs) await ctx.processes.stop(run.id);
      record(
        'verified',
        runs.map((run) => run.id),
      );
      await operationTimeout(
        confirmOwnerMessagesStopped(projectId, taskId, captured, {
          kind: 'run',
          id: active.run.id,
          version: active.deliveryEpoch,
        }),
        15000,
        'Interrupted message delivery has not settled',
      );
      active.stopError = undefined;
      ctx.events.settleRuntime(active);
    } catch (error) {
      record('failed');
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
