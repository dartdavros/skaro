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
  const previous = active.timeline.state.items.find((i) => i.id === item.id);
  if (
    previous?.kind === 'proposal' &&
    previous.proposal.type === 'architecture' &&
    item.proposal.type === 'architecture' &&
    previous.proposal.packageId === item.proposal.packageId &&
    previous.state === item.state &&
    previous.result?.error === item.result?.error &&
    previous.proposal.contentRef === item.proposal.contentRef
  )
    return;
  ctx.history.skaroEvent(active, {
    t: 'item.upsert',
    item: { ...item, turnId: previous?.turnId ?? active.timeline.state.turns.at(-1)?.id ?? '' },
  });
  const decided = item.state === 'applied' || item.state === 'rejected';
  if (!decided || (previous?.kind === 'proposal' && previous.state === item.state)) return;
  const context = ctx.project(scope.projectId);
  context.invalidate();
  const task = (await context.load()).tasks.find((t) => t.id === scope.taskId);
  if (task && !['done', 'cancelled'].includes(task.status))
    await ctx.messages
      .continueAfter(active, architectureDecision(item))
      .catch((error: unknown) =>
        console.error(`${scope.taskId} continue after C4 decision:`, error),
      );
}

function architectureDecision(item: Extract<Item, { kind: 'proposal' }>): string {
  const title = item.proposal.type === 'architecture' ? item.proposal.title : '';
  return item.state === 'applied'
    ? `The owner accepted the architecture package "${title}" and Skaro applied it. Continue the task.`
    : `The owner rejected the architecture package "${title}". Continue the task without it.`;
}
