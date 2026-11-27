import type {
  ControlPlanArgs,
  PlanKeyArgs,
  PreparePlanArgs,
  RevisePlanArgs,
  ProjectPlanningHandlers,
  ProposeSavedPlanArgs,
  SkaroScope,
  ToolResult,
} from '@skaro/mcp-server';
import type { ChatEngine } from './chat-engine';
import { ChatPlanningStore, preparedPlanProblem, qualifiedPlan } from './chat-planning-store';
import { savedPlanStatus, planStatusText } from './chat-planning-status';
import { planningReadiness } from './chat-planning-readiness';
import type { LiveChat } from './chat-model';
import { serializeChatMutation } from './chat-mutations';
import { reviseChatPlan } from './chat-plan-revision';
import { beginPlanningIntent } from './chat-planning-intent';

export class ChatPlanning implements ProjectPlanningHandlers {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }

  store(live: LiveChat): ChatPlanningStore {
    return new ChatPlanningStore(this.ctx.deps.db, live.chat.id);
  }

  beginTaskPlan(decisionId: string | undefined, scope: SkaroScope): Promise<ToolResult> {
    const live = this.ctx.context.caller(scope);
    return serializeChatMutation(live, async () =>
      beginPlanningIntent(this.ctx.deps.db, live, decisionId),
    );
  }

  async preparePlan(args: PreparePlanArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.ctx.context.caller(scope);
    return serializeChatMutation(live, () => this.prepare(live, args));
  }
  async revisePlan(args: RevisePlanArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.ctx.context.caller(scope);
    return serializeChatMutation(live, () => reviseChatPlan(this.ctx, live, args));
  }

  async prepare(live: LiveChat, args: PreparePlanArgs): Promise<ToolResult> {
    const artifacts = await this.ctx.project(live.projectId).load();
    const store = this.store(live);
    const normalized = qualifiedPlan(args);
    const prior = store.get(args.key);
    if (prior) {
      const {
        state: _state,
        reason: _reason,
        attempts: _legacyAttempts,
        lastProgress: _legacyProgress,
        revision: _revision,
        ...contents
      } = prior;
      if (JSON.stringify(contents) !== JSON.stringify(normalized)) {
        return {
          text: 'This key already has a different saved plan. Do not overwrite prepared work.',
          isError: true,
        };
      }
      return { text: planStatusText(prior, live.timeline.state.items, artifacts) };
    }
    if (store.current())
      return {
        text: 'Finish or explicitly cancel the current planning operation first.',
        isError: true,
      };
    const problem = preparedPlanProblem(normalized, artifacts);
    if (problem) return { text: problem, isError: true };
    const plan = { ...normalized, state: 'active' as const };
    store.put(plan);
    return {
      text: `Saved ${args.expectedTotal} complete task records. Skaro publishes the proposal when prerequisites are ready.\n${planStatusText(plan, live.timeline.state.items, artifacts)}`,
    };
  }

  async proposeSavedPlan(args: ProposeSavedPlanArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.ctx.context.caller(scope);
    return serializeChatMutation(live, () => this.propose(live, args));
  }

  async publishReady(live: LiveChat, key: string, current: () => boolean): Promise<void> {
    await serializeChatMutation(live, async () => {
      if (!current()) return;
      const result = await this.propose(live, { key }, current);
      if (result.isError && current()) this.ctx.history.notice(live, 'other', 'error', result.text);
    });
  }

  async propose(
    live: LiveChat,
    args: ProposeSavedPlanArgs,
    current = () => true,
  ): Promise<ToolResult> {
    const store = this.store(live);
    const plan = store.get(args.key);
    if (!plan) return { text: 'No saved plan with this key.', isError: true };
    if (plan.state === 'complete') {
      return {
        text: planStatusText(
          plan,
          live.timeline.state.items,
          await this.ctx.project(live.projectId).load(),
        ),
      };
    }
    if (['paused', 'cancelled', 'blocked'].includes(plan.state)) {
      return {
        text: `Plan is ${plan.state}: ${plan.reason}. Resume only within the owner-authorized request.`,
        isError: true,
      };
    }
    if (
      args.milestone &&
      !plan.milestones.some((m) => m.milestone === args.milestone!.toUpperCase())
    ) {
      return { text: 'This milestone is outside the saved plan.', isError: true };
    }
    const artifacts = await this.ctx.project(live.projectId).load();
    const problem = preparedPlanProblem(plan, artifacts);
    if (problem) return { text: problem, isError: true };
    const all = plan.milestones.flatMap((m) => m.tasks);
    const readiness = planningReadiness(all, artifacts, live.timeline.state.items);
    if (readiness.waiting.length || readiness.blockers.length) {
      const reason = [...readiness.waiting, ...readiness.blockers].join('\n');
      store.put({ ...plan, state: readiness.blockers.length ? 'blocked' : 'waiting', reason });
      return {
        text: `The complete plan is saved but is not ready for confirmation. ${reason}`,
        ...(readiness.blockers.length ? { isError: true } : {}),
      };
    }
    await this.ctx.planReview.consolidate(live);
    if (!current()) return { text: 'Planning operation was superseded.', isError: true };
    this.ctx.planReview.offer(live, plan, artifacts);
    store.put({ ...plan, state: 'complete', reason: undefined });
    return {
      text: `One complete plan is ready for owner confirmation.\n${planStatusText(store.get(plan.key)!, live.timeline.state.items, artifacts)}`,
    };
  }

  async finishPlan(args: PlanKeyArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.ctx.context.caller(scope);
    return serializeChatMutation(live, () => this.finish(live, args));
  }

  async finish(live: LiveChat, args: PlanKeyArgs): Promise<ToolResult> {
    const store = this.store(live);
    const plan = store.get(args.key);
    if (!plan) return { text: 'No saved plan with this key.', isError: true };
    if (plan.state === 'cancelled' || plan.state === 'paused') {
      return { text: `Plan is ${plan.state}; completion was not verified.`, isError: true };
    }
    const artifacts = await this.ctx.project(live.projectId).load();
    const problem = preparedPlanProblem(plan, artifacts);
    const status = savedPlanStatus(plan, live.timeline.state.items, artifacts);
    if (problem || status.counts.unproposed || status.counts.missing) {
      return {
        text: `Planning is incomplete. ${problem ?? ''}\n${planStatusText(plan, live.timeline.state.items, artifacts)}`,
        isError: true,
      };
    }
    store.put({ ...plan, state: 'complete', reason: undefined });
    return {
      text: `All saved tasks were proposed in one card. Skaro creates the selected tasks after owner confirmation.\n${planStatusText(store.get(plan.key)!, live.timeline.state.items, artifacts)}`,
    };
  }

  async controlPlan(args: ControlPlanArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.ctx.context.caller(scope);
    this.ctx.planningContinuation.userMessage(live);
    return serializeChatMutation(live, () => this.control(live, args));
  }

  async control(live: LiveChat, args: ControlPlanArgs): Promise<ToolResult> {
    const store = this.store(live);
    const plan = store.get(args.key);
    if (!plan || plan.state === 'complete')
      return { text: 'No unfinished plan with this key.', isError: true };
    if (plan.state === 'cancelled' && args.action !== 'cancel') {
      return {
        text: 'Cancelled plans cannot be restarted; prepare a new owner-authorized plan.',
        isError: true,
      };
    }
    this.ctx.planningContinuation.userMessage(live);
    store.put({
      ...plan,
      state:
        args.action === 'resume' ? 'active' : args.action === 'cancel' ? 'cancelled' : 'paused',
      reason: args.reason,
    });
    return { text: `Plan ${args.key}: ${store.get(args.key)!.state}. ${args.reason}` };
  }
}
