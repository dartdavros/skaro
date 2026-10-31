import type { TimelineEvent } from '@skaro/timeline';
import type { ChatEngine } from './chat-engine';
import type { LiveChat } from './chat-model';
import { planStatusText } from './chat-planning-status';
import { planningNextStep } from './chat-planning-next';

/** Continuations are bounded, serialized with user messages, and scoped to a saved plan. */
export class ChatPlanningContinuation {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }

  stop(live: LiveChat, reason: string): void {
    live.planningRevision++;
    if (live.planningTimer) clearTimeout(live.planningTimer);
    live.planningTimer = undefined;
    live.planningWake = false;
    const store = this.ctx.planning.store(live);
    const plan = store.current();
    if (plan) store.put({ ...plan, state: 'paused', reason });
  }

  userMessage(live: LiveChat): void {
    live.planningRevision++;
    live.planningContinuations = 0;
    if (live.planningTimer) clearTimeout(live.planningTimer);
    live.planningTimer = undefined;
    live.planningWake = false;
  }

  settled(live: LiveChat): Promise<void> {
    return live.planningPending ?? Promise.resolve();
  }

  onEvent(live: LiveChat, event: TimelineEvent): void {
    if (event.t !== 'turn.completed') return;
    live.planningSent = false;
    if (event.outcome !== 'done') {
      this.stop(live, `Agent turn ${event.outcome}; owner must resume planning explicitly.`);
      return;
    }
    this.schedule(live);
  }

  schedule(live: LiveChat): void {
    if (live.planningSending) {
      live.planningWake = true;
      return;
    }
    if (live.planningSent) return;
    if (live.planningTimer || live.chat.archived || !this.ctx.planning.store(live).current())
      return;
    const revision = live.planningRevision;
    live.planningTimer = setTimeout(() => {
      live.planningTimer = undefined;
      live.planningSending = true;
      live.planningPending = this.continue(live, revision)
        .catch((error: unknown) => {
          // Cancellation owns the old operation: it must not pause a newer plan or
          // report errors through storage that its owner may already be closing.
          if (revision !== live.planningRevision) return;
          this.stop(live, error instanceof Error ? error.message : String(error));
          this.ctx.history.notice(live, 'other', 'error', String(error));
        })
        .finally(() => {
          live.planningSending = false;
          live.planningPending = undefined;
          if (live.planningWake) {
            live.planningWake = false;
            this.schedule(live);
          }
        });
    }, 0);
  }

  private async continue(live: LiveChat, revision: number): Promise<void> {
    if (
      revision !== live.planningRevision ||
      live.chat.archived ||
      live.timeline.state.status !== 'idle' ||
      live.timeline.state.interactions.length
    )
      return;
    const store = this.ctx.planning.store(live);
    let plan = store.current();
    if (!plan || !['active', 'waiting'].includes(plan.state)) return;
    const artifacts = await this.ctx.project(live.projectId).load();
    if (
      revision !== live.planningRevision ||
      live.chat.archived ||
      live.timeline.state.status !== 'idle'
    )
      return;
    // A tool may have finished or paused the operation while artifacts were loading.
    plan = store.get(plan.key);
    if (!plan || !['active', 'waiting'].includes(plan.state)) return;
    const next = planningNextStep(
      plan,
      live.timeline.state.items,
      artifacts,
      live.planningContinuations,
    );
    const { status, attempts } = next;
    if (next.action === 'waiting') {
      store.put({ ...plan, state: 'waiting', reason: next.reason });
      return;
    }
    if (next.action === 'blocked') {
      plan = {
        ...plan,
        state: 'blocked',
        reason: next.reason,
      };
      store.put(plan);
      const ru = this.ctx.deps.locale() === 'ru';
      this.ctx.history.notice(
        live,
        'other',
        'error',
        ru
          ? `Планирование не завершено: предложено ${status.counts.proposed} из ${status.counts.prepared}, осталось ${status.counts.unproposed}. Автопродолжение остановлено; сохранённый план доступен агенту.`
          : `Planning is incomplete: proposed ${status.counts.proposed}/${status.counts.prepared}, remaining ${status.counts.unproposed}. Automatic continuation stopped; the saved plan is retained.`,
      );
      return;
    }
    store.put({
      ...plan,
      state: 'active',
      reason: undefined,
      attempts: attempts + 1,
      lastProgress: status.counts.proposed,
    });
    live.planningContinuations++;
    await this.ctx.conversation.continuePlanning(
      live,
      {
        text:
          'Continue the existing owner-authorized planning operation only. It is not complete. ' +
          'Call propose_saved_plan for all remaining ready milestones, then finish_plan. Do not ' +
          'repeat existing cards, invent task counts, or stop to wait for T-xxx numbers. ' +
          'If an indispensable owner decision is missing, use the structured question tool and ' +
          'control_plan pause with its concrete reason.\n' +
          planStatusText(plan, live.timeline.state.items, artifacts),
      },
      revision,
    );
  }
}
