import { isDeepStrictEqual } from 'node:util';
import { indexTasks, startBlocker } from '@skaro/core';
import { requireTaskStartup } from './task-startup-generation';
import { hasOwnerOrigin } from './owner-command-provenance';
import { key } from './task-run-helpers';
import { transitionPending } from './task-lifecycle-journal';
import type { TaskRunEngine } from './task-run-engine';

/** An acknowledged owner message can still be waiting for a checkout with no run. */
export async function recoverQueuedTaskStarts(ctx: TaskRunEngine, projectId: string) {
  const { tasks } = await ctx.project(projectId).load();
  const index = indexTasks(tasks);
  for (const task of tasks) {
    if (ctx.closing) return;
    const { id } = task;
    const saved = ctx.startup.read(projectId, id);
    if (
      task.status !== 'todo' ||
      transitionPending(ctx.deps.db, projectId, id) ||
      !saved?.inputs.length ||
      saved.error ||
      saved.builtin ||
      saved.transition ||
      startBlocker(task, index) ||
      ctx.deps.db.latestRun(projectId, id)
    )
      continue;
    if (
      !saved.inputs.every((input) => {
        if (input.internal || !input.commandId) return false;
        const command = ctx.deps.db.commands.get(input.commandId);
        return (
          command?.state === 'delivered' &&
          command.method === 'task.send' &&
          command.owner === `${projectId}:${id}` &&
          isDeepStrictEqual(command.args, [projectId, id, input]) &&
          hasOwnerOrigin(ctx.deps.db, command)
        );
      })
    )
      continue;
    requireTaskStartup(ctx.deps.db, ctx.startup, projectId, id);
    const owner = key(projectId, id);
    const queue = ctx.queue.state();
    if (queue.running.includes(owner) || queue.queued.includes(owner)) continue;
    // Reuse the exact journalled command. enqueue deduplicates the durable input by ID.
    await ctx.scheduling.enqueue(projectId, id, saved.inputs[0]!);
  }
}
