import { randomUUID } from 'node:crypto';
import type { RevisePlanArgs, ToolResult } from '@skaro/mcp-server';
import type { ChatEngine } from './chat-engine';
import type { LiveChat } from './chat-model';
import { PlanJournal } from './chat-plan-journal';
import { preparedPlanProblem, qualifiedPlan } from './chat-planning-store';
import { planningReadiness } from './chat-planning-readiness';
import { pendingC4PlanProblem } from './chat-plan-c4';
import { currentTurn } from './chat-settings-helpers';

/** One durable revision retires old approval IDs before the corrected draft can be accepted. */
export async function reviseChatPlan(
  ctx: ChatEngine,
  live: LiveChat,
  args: RevisePlanArgs,
): Promise<ToolResult> {
  const journal = new PlanJournal(ctx, live);
  journal.restore();
  const store = ctx.planning.store(live);
  const prior = store.get(args.key);
  if (!prior || prior.state === 'cancelled')
    return { text: 'No revisable saved plan with this key.', isError: true };
  if (store.current() && store.current()!.key !== args.key)
    return { text: 'Another saved plan is active; finish it first.', isError: true };
  const records = journal
    .list()
    .filter(
      (r) =>
        r.item.proposal.type === 'plan' &&
        r.item.proposal.planKey === args.key &&
        r.item.state !== 'superseded',
    );
  const cards = ctx.proposals
    .proposals(live)
    .filter(
      (p) =>
        p.proposal.type === 'plan' && p.proposal.planKey === args.key && p.state !== 'superseded',
    );
  if (
    cards.some(
      (p) =>
        p.state !== 'pending' ||
        p.result?.tasks?.length ||
        p.result?.selected?.length ||
        p.result?.omitted?.length,
    ) ||
    records.some((r) => r.creating)
  )
    return {
      text: 'This plan was already decided or creation began. Use reviewed task updates, delete_tasks or replan_tasks; confirmed work cannot be overwritten.',
      isError: true,
    };
  const { reason, ...contents } = args;
  if (!reason.trim()) return { text: 'An owner-requested revision needs a reason.', isError: true };
  const normalized = qualifiedPlan(contents);
  const {
    state: _state,
    reason: _reason,
    attempts: _attempts,
    lastProgress: _progress,
    revision: _revision,
    ...previous
  } = prior;
  if (JSON.stringify(previous) === JSON.stringify(normalized))
    return {
      text: 'The saved draft already has these contents. No duplicate revision was created.',
    };
  const artifacts = await ctx.project(live.projectId).load();
  const problem =
    preparedPlanProblem(normalized, artifacts) ??
    (await pendingC4PlanProblem(
      ctx.deps.db,
      live.projectId,
      normalized.milestones.flatMap((m) => m.tasks),
    ));
  if (problem) return { text: problem, isError: true };
  const readiness = planningReadiness(
    normalized.milestones.flatMap((m) => m.tasks),
    artifacts,
    live.timeline.state.items.filter((i) => !cards.some((p) => p.id === i.id)),
  );
  if (readiness.blockers.length || readiness.waiting.length)
    return { text: [...readiness.blockers, ...readiness.waiting].join('\n'), isError: true };
  const revisedDraft = {
    ...normalized,
    revision: (prior.revision ?? 0) + 1,
    // The full graph is presented below; acceptance/creation remain separate decisions.
    state: 'complete' as const,
    attempts: 0,
    lastProgress: 0,
  };
  journal.saveAll([
    ...cards.map((item) => ({ item: { ...item, state: 'superseded' as const } })),
    {
      revisedDraft,
      item: {
        id: `skaro-proposal-${randomUUID()}`,
        turnId: currentTurn(live),
        kind: 'proposal',
        state: 'pending',
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'proposal', ref: 'plan' },
        proposal: {
          type: 'plan',
          complete: true,
          planKey: args.key,
          title: args.title,
          tasks: ctx.planReview.tasks(revisedDraft, artifacts),
        },
      },
    },
  ]);
  ctx.proposals.addNotes(live.chat.id, [
    `The owner requested a plan revision: ${reason}. The old approval is superseded. Review the complete new plan before creation.`,
  ]);
  return {
    text: `Revised draft ${args.key}: ${args.expectedTotal} tasks await a fresh owner confirmation. Previous approval IDs are superseded; no task files changed.`,
  };
}
