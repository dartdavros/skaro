import type { ResourceConsumer } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import {
  accessKey,
  checkoutTaskIds,
  recordKey,
  restoredCheckoutInUse,
  type RetainedCheckout,
} from './worktree-retention-model';

/** Observational consumers, not RC-2 resource reservations or heartbeat leases. */
export function worktreeConsumers(
  ctx: TaskRunEngine,
  projectId: string,
  path: string,
  generation: number,
): ResourceConsumer[] {
  const consumers: ResourceConsumer[] = [];
  const add = (id: string, kind: ResourceConsumer['kind']) =>
    consumers.push({ id: `worktree:${id}`, kind, generation });
  const cleaned = ctx.deps.db.getSetting<RetainedCheckout | null>(recordKey(path), null);
  if (restoredCheckoutInUse(cleaned, ctx.deps.db.getSetting(accessKey(path), 0, { strict: true })))
    add(`access:${path}`, 'preview');
  const owners = checkoutTaskIds(path, ctx.deps.db.listRuns(projectId));
  for (const owner of ctx.reviews.protectedEnvironments())
    if (owner.projectId === projectId && owners.has(owner.taskId))
      add(`review:${owner.taskId}`, 'preview');
  const queue = ctx.queue.state();
  const keys = new Set([...owners].map((id) => `${projectId}\n${id}`));
  for (const key of [...queue.running, ...queue.queued])
    if (keys.has(key)) add(`queue:${key.replace('\n', ':')}`, 'agent');
  for (const op of ctx.integrations.store.all(projectId))
    if (
      (op.worker || op.executor) &&
      (owners.has(op.taskId) ||
        op.results.some((result) => result.worktree === path || owners.has(result.taskId)))
    )
      add(`integration:${op.id}`, 'integration');
  for (const active of ctx.active.values())
    if (
      active.run.worktree === path &&
      (active.session ||
        active.attaching ||
        active.switching ||
        active.stopping ||
        active.afterTurn ||
        active.release ||
        active.operations.size ||
        active.timeline.state.status !== 'idle')
    )
      add(`run:${active.run.id}`, 'agent');
  return [...new Map(consumers.map((consumer) => [consumer.id, consumer])).values()];
}
