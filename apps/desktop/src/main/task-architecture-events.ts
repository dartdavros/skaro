import type { Item } from '@skaro/timeline';
import type { SkaroScope } from '@skaro/mcp-server';
import type { TaskRunEngine } from './task-run-engine';

/** Preserve the existing C4 decision delivery while the facade composes task services. */
export async function taskArchitectureEvent(
  ctx: TaskRunEngine,
  scope: SkaroScope,
  item: Extract<Item, { kind: 'proposal' }>,
) {
  if (!scope.taskId) throw new Error('Missing architecture task');
  const active = await ctx.history.restore(scope.projectId, scope.taskId);
  if (!active) throw new Error('Architecture task history is unavailable');
  await ctx.history.drain(active);
  if (item.proposal.type === 'architecture')
    item = { ...item, proposal: { ...item.proposal, blocksTask: false } };
  const previous = active.timeline.state.items.find((i) => i.id === item.id);
  if (
    previous?.kind === 'proposal' &&
    previous.proposal.type === 'architecture' &&
    item.proposal.type === 'architecture' &&
    previous.proposal.packageId === item.proposal.packageId &&
    previous.proposal.blocksTask === item.proposal.blocksTask &&
    previous.state === item.state &&
    previous.result?.error === item.result?.error &&
    previous.proposal.contentRef === item.proposal.contentRef
  )
    return;
  ctx.history.skaroEvent(active, {
    t: 'item.upsert',
    item: { ...item, turnId: previous?.turnId ?? active.timeline.state.turns.at(-1)?.id ?? '' },
  });
}
