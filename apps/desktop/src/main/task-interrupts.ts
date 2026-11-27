import type { TaskRunEngine } from './task-run-engine';
import { CommandCancelled, stopOwnerMessages } from './owner-commands';
import { key } from './task-run-helpers';
import { resourcesFor } from './resource-execution';
import { stopBuiltinTask } from './builtin-task-stop';
import { stopManagedTask } from './managed-task-stop';
import { taskStopDeliveries } from './task-stop-deliveries';
import { TaskStopAttempts } from './task-stop-attempts';
import { recoverTaskTransitions } from './task-lifecycle-recovery';
import { currentTransition } from './task-lifecycle-journal';
import type { ActiveRun } from './task-run-model';

export class TaskInterrupts {
  private readonly stops = new TaskStopAttempts();
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }
  stopping(project: string, task: string) {
    return this.stops.has(key(project, task));
  }

  interrupt(projectId: string, taskId: string, ownerStop: boolean): Promise<void> {
    const owner = key(projectId, taskId);
    const latest = () => this.ctx.deps.db.latestRun(projectId, taskId)?.id;
    const run = latest();
    return this.stops.run(
      owner,
      () => this.shutdown(projectId, taskId),
      async () => {
        if (run && latest() === run) await this.ctx.processes.stop(run);
      },
      ownerStop,
      () => {
        const token = currentTransition(this.ctx.deps.db, projectId, taskId)?.token;
        if (!token) return;
        void Promise.resolve(this.ctx.parking.get(owner))
          .catch(() => undefined)
          .then(() => {
            if (this.ctx.closing || this.ctx.parking.has(owner)) return;
            const entry = currentTransition(this.ctx.deps.db, projectId, taskId);
            if (
              entry?.token === token &&
              entry.run === (run ?? null) &&
              entry.target !== 'in_progress' &&
              entry.phase === 'requested'
            )
              return recoverTaskTransitions(this.ctx, projectId, token);
          })
          .catch((error: unknown) => console.error('Late task stop verification:', error));
      },
    );
  }

  private async shutdown(projectId: string, taskId: string): Promise<void> {
    resourcesFor(this.ctx.deps.db)?.stopOwner(projectId, `task:${taskId}`);
    if (this.ctx.handoff.changing(this.ctx.active.get(key(projectId, taskId))))
      throw new Error('Wait for the agent handoff to finish before stopping the task.');
    this.ctx.continuation.stop(projectId, taskId);
    const commands = stopOwnerMessages(projectId, taskId);
    // A task feed can address an integration resolver. Its interrupt acknowledgement does not
    // prove transport retirement, so a task-runtime stop must not certify that delivery.
    const integrationOwnsDelivery = this.ctx.integrations.store
      .all(projectId)
      .some(
        (op) =>
          !['applied', 'stale'].includes(op.state) &&
          (op.taskId === taskId || op.results.some((result) => result.taskId === taskId)),
      );
    this.ctx.startup.cancel(projectId, taskId);
    const k = key(projectId, taskId);
    this.ctx.queuedInputs.delete(k);
    const current =
      this.ctx.active.get(k) ??
      (this.ctx.deps.db.latestRun(projectId, taskId)
        ? await this.ctx.history.restore(projectId, taskId)
        : undefined);
    const stopRun = (active: ActiveRun) => {
      active.deliveryEpoch++;
      active.sessionStartup?.abort(new CommandCancelled());
      return active.run.agent === 'skaro'
        ? stopBuiltinTask(
            this.ctx,
            active,
            taskStopDeliveries(
              this.ctx.deps.db,
              projectId,
              taskId,
              commands,
              integrationOwnsDelivery,
            ),
          )
        : stopManagedTask(this.ctx, active, commands, integrationOwnsDelivery);
    };
    if (current) return stopRun(current);
    await this.ctx.integrations.controls.interrupt(projectId, taskId);
    for (const run of this.ctx.deps.db.listRuns(projectId, taskId, { includeRetired: true }))
      await this.ctx.processes.stop(run.id);
    const queued = this.ctx.queue.cancel(k);
    const active = this.ctx.active.get(k);
    if (active) return stopRun(active);
    if (queued) {
      this.ctx.queuedInputs.delete(k);
      // A started task goes back to what its feed says; a new one was never running.
      this.ctx.setRuntime(projectId, taskId, 'idle');
    }
  }
}
