import { isTaskParked } from '@skaro/core';
import { randomUUID } from 'node:crypto';
import type { TaskParkReceipt } from '../shared/task-park';
import { CommandCancelled } from './owner-commands';
import { mutateTaskOwner } from './project-task-mutations';
import { key } from './task-run-helpers';
import type { TaskRunEngine } from './task-run-engine';
import {
  beginTransition,
  currentTransition,
  transitionPhase,
  type TaskTransition,
} from './task-lifecycle-journal';
import { DecisionNotDispatched } from './decision-not-dispatched';
import { reportLifecycleConflict } from './task-lifecycle-conflict';
import { operationTimeout } from '@skaro/timeline';

export type ParkedTaskStatus = 'paused' | 'stopped';

/** The task command owns a durable state change after verified agent shutdown. */
export async function parkTask(
  ctx: TaskRunEngine,
  projectId: string,
  taskId: string,
  status: ParkedTaskStatus,
  recovering?: TaskTransition,
  requestId: string = recovering?.commandId ?? randomUUID(),
): Promise<TaskParkReceipt> {
  if (!isTaskParked(status)) throw new Error('Invalid task pause or stop status');
  const context = ctx.project(projectId);
  const ownerStop = !recovering && status === 'stopped';
  const owner = key(projectId, taskId);
  const previous = ctx.parking.get(owner);
  if (previous) {
    const reached = await previous;
    if (reached.status === 'stopped' || reached.status === status) return { ...reached, requestId };
    return parkTask(ctx, projectId, taskId, status, recovering, requestId);
  }
  const db = ctx.deps.db;
  const work = (async () => {
    const before = await context.store.readTask(taskId);
    const run = db.latestRun(projectId, taskId)?.id ?? null;
    if (
      recovering &&
      (recovering.token !== currentTransition(db, projectId, taskId)?.token ||
        recovering.run !== run ||
        (before.status !== recovering.from && before.status !== recovering.target))
    )
      throw new DecisionNotDispatched(
        'The original lifecycle request no longer matches this task run',
      );
    const pending = currentTransition(db, projectId, taskId);
    const unfinished = pending && pending.phase !== 'settled';
    const active = ctx.active.get(owner);
    const busy = !!(
      ctx.startup.read(projectId, taskId)?.inputs.length ||
      active?.session ||
      active?.attaching ||
      ctx.queue.state().queued.includes(owner) ||
      ctx.queue.state().running.includes(owner) ||
      db.commands.hasPendingInput(`${projectId}:${taskId}`)
    );
    if (
      !recovering &&
      !unfinished &&
      !busy &&
      (before.status === status || before.status === 'stopped')
    )
      return { requestId, status: before.status, revision: pending?.revision ?? 0 };
    if (before.status === 'stopped') status = 'stopped';
    const canPark =
      !before.archived &&
      (recovering ||
        ((unfinished || busy) && isTaskParked(before.status)) ||
        before.status === 'in_progress' ||
        before.status === 'failed' ||
        (before.status === 'paused' && status === 'stopped') ||
        (before.status === 'todo' && busy));
    if (!canPark) throw new DecisionNotDispatched('The current task cannot be paused or stopped');
    const entry =
      recovering ??
      (unfinished &&
      pending.target === status &&
      pending.run === run &&
      (pending.from === before.status || pending.target === before.status)
        ? pending
        : undefined) ??
      beginTransition(db, projectId, {
        id: taskId,
        from: before.status,
        target: status,
        run,
        commandId: requestId,
      });
    if (entry.phase === 'requested') {
      ctx.changed(projectId, taskId);
      await ctx.messages.interrupt(projectId, taskId, ownerStop);
      transitionPhase(db, projectId, entry, 'confirmed');
    }
    const receipt = await mutateTaskOwner(context, taskId, async () => {
      const task = await context.store.readTask(taskId);
      if (
        task.archived ||
        (task.status !== entry.from && task.status !== status) ||
        (db.latestRun(projectId, taskId)?.id ?? null) !== run
      )
        throw new Error('The task changed while it was stopping');
      ctx.scheduling.forgetAwaiting(projectId, [taskId]);
      if (status === 'stopped') ctx.stages.rememberStoppedCheckout(projectId, taskId);
      if (task.status !== status) await context.store.updateTaskAtomically(taskId, { status });
      context.invalidate();
      await ctx.stages.sync(projectId, taskId);
      ctx.setRuntime(projectId, taskId, 'idle');
      return db.settings.atomic(() => {
        db.addEvent(projectId, 'task_changed', {
          task: taskId,
          status,
          previousStatus: entry.from,
        });
        if (!transitionPhase(db, projectId, entry, 'settled')) throw new CommandCancelled();
        return { requestId, status, revision: currentTransition(db, projectId, taskId)!.revision };
      });
    });
    ctx.changed(projectId, taskId);
    ctx.deps.emit('project.changed', { projectId });
    return receipt;
  })();
  ctx.parking.set(owner, work);
  try {
    return await work;
  } catch (error) {
    const pending = currentTransition(db, projectId, taskId);
    if (pending && pending.phase !== 'settled') {
      await operationTimeout(
        reportLifecycleConflict(ctx, projectId, pending),
        5000,
        'Task stop incident publication is pending',
      ).catch((reason: unknown) => console.error('Task stop incident:', reason));
    }
    throw error;
  } finally {
    ctx.parking.delete(owner);
  }
}

export async function resumeParkedTask(
  ctx: TaskRunEngine,
  projectId: string,
  taskId: string,
  requireCurrent: () => void,
): Promise<void> {
  const context = ctx.project(projectId);
  await mutateTaskOwner(context, taskId, async () => {
    const task = await context.store.readTask(taskId);
    requireCurrent();
    if (task.archived) throw new CommandCancelled();
    if (!isTaskParked(task.status)) return;
    await context.store.updateTaskAtomically(taskId, { status: 'in_progress' });
    context.invalidate();
    await ctx.stages.sync(projectId, taskId);
    ctx.changed(projectId, taskId);
    ctx.deps.emit('project.changed', { projectId });
  });
}
