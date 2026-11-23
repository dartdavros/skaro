import type { TimelineEvent } from '@skaro/timeline';
import type { ChatEngine } from './chat-engine';
import type { LiveChat } from './chat-model';
import { nextPlanningIntent, planningIntent, stopPlanningIntent } from './chat-planning-intent';

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
    stopPlanningIntent(this.ctx.deps.db, live);
  }

  userMessage(live: LiveChat): void {
    live.planningRevision++;
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
    if (
      this.ctx.closing ||
      live.stopping ||
      live.stopError ||
      live.planningTimer ||
      live.chat.archived ||
      (!this.ctx.planning.store(live).current() && !planningIntent(this.ctx.deps.db, live))
    )
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
    const current = () =>
      !this.ctx.closing &&
      !live.stopping &&
      !live.stopError &&
      revision === live.planningRevision &&
      !live.chat.archived &&
      live.timeline.state.status === 'idle' &&
      !live.timeline.state.interactions.length;
    if (!current()) return;
    const plan = this.ctx.planning.store(live).current();
    if (plan) {
      if (plan.state === 'active' || plan.state === 'waiting')
        await this.ctx.planning.publishReady(live, plan.key, current);
      return;
    }
    const next = nextPlanningIntent(this.ctx.deps.db, live);
    if (next === 'exhausted') {
      const ru = this.ctx.deps.locale() === 'ru';
      this.ctx.history.notice(
        live,
        'other',
        'error',
        ru
          ? 'Агент не подготовил структурированный план или предложение задач. Автопродолжение остановлено.'
          : 'The agent produced neither structured task records nor a task proposal. Automatic continuation stopped.',
      );
      return;
    }
    if (next !== 'continue') return;
    await this.ctx.conversation.continuePlanning(
      live,
      {
        internal: true,
        text:
          'Continue the registered owner request for implementation tasks. Read get_project_context ' +
          'and current C4 when relevant. Call propose_tasks for a single task or prepare_plan for the full graph. ' +
          'If a prerequisite needs a new decision, open the actual proposal and bind it with begin_task_plan, ' +
          'or ask a structured question for indispensable missing information.',
      },
      revision,
    );
  }
}
