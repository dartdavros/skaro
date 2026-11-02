import { indexTasks, startBlocker } from '@skaro/core';
import type { MessageInput } from '../shared/ipc';
import type { TaskRunEngine } from './task-run-engine';
import type { BuiltinTaskLaunchRequest } from './builtin-task-start';
import { serializeTaskMutation } from './project-task-mutations';
import { findTask, key } from './task-run-helpers';
import { CommandCancelled } from './owner-commands';
import { capturePendingBuiltinStart } from './builtin-task-pending';

/** Explicit main-only entry into the existing FIFO queue; it creates no run, grant or process. */
export async function queueBuiltinTask(
  ctx: TaskRunEngine,
  request: BuiltinTaskLaunchRequest,
  enqueueLocked: (input: MessageInput, requireCurrent: () => void) => Promise<void>,
) {
  const { projectId, taskId, signal } = request;
  const input = structuredClone(request.input);
  const epoch = ctx.startup.cancellationEpoch(projectId, taskId);
  signal.throwIfAborted();
  if (ctx.closing) throw new CommandCancelled();
  if (!ctx.deps.builtinSessions) throw new Error('Builtin task authorization is unavailable');
  if (
    typeof input.text !== 'string' ||
    !input.text.trim() ||
    input.images?.length ||
    input.internal ||
    typeof input.commandId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,160}$/.test(input.commandId)
  )
    throw new Error('Builtin task launch requires an explicit admitted text input');
  const requireAdmission = () => {
    signal.throwIfAborted();
    if (ctx.closing || ctx.startup.cancellationEpoch(projectId, taskId) !== epoch)
      throw new CommandCancelled();
    if (input.commandId && ctx.deps.db.commands.get(input.commandId)?.state === 'cancelled')
      throw new CommandCancelled();
  };
  const settings = await ctx.deps.builtinSessions.resolveStart(request.settings, signal);
  await serializeTaskMutation(ctx.project(projectId), async () => {
    requireAdmission();
    const artifacts = await ctx.project(projectId).store.load();
    requireAdmission();
    const task = findTask(artifacts, taskId);
    if (!artifacts.tasks.some((entry) => entry.id === taskId) || task.archived)
      throw new Error('Builtin launch requires a current, non-archived task');
    const blocker = startBlocker(task, indexTasks(artifacts.tasks));
    if (blocker) throw new Error(`The task cannot start: ${blocker}`);
    const owner = key(projectId, taskId);
    const queue = ctx.queue.state();
    if (
      ctx.active.has(owner) ||
      ctx.deps.db.listRuns(projectId, taskId).length ||
      queue.queued.includes(owner) ||
      queue.running.includes(owner)
    )
      throw new Error(
        'A started or scheduled task requires the existing continuation/handoff path',
      );
    const retry = ctx.startup.retryBuiltin(projectId, taskId, settings, input);
    if (!retry) ctx.startup.selectBuiltin(projectId, taskId, settings);
    const requirePending = capturePendingBuiltinStart(
      ctx.startup,
      projectId,
      taskId,
      () => ctx.closing,
    );
    try {
      await enqueueLocked(input, () => {
        requireAdmission();
        requirePending();
      });
    } catch (error) {
      // Revoke only this attempt; never erase a replacement selected after cancellation.
      try {
        requirePending();
        if (!retry) ctx.startup.delivered(projectId, taskId);
      } catch (cancelled) {
        if (!(cancelled instanceof CommandCancelled)) throw cancelled;
      }
      throw error;
    }
  });
}
