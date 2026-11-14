import {
  decisionAnswerOutcome,
  type DecisionAnswer,
  type ProjectDecision,
  type ProjectDecisionMethods,
} from '../../../shared/project-decisions';

export type CardStatus =
  'pending' | 'sending' | 'error' | 'stale' | 'expired' | 'answered' | 'denied';
export class DecisionCardState {
  entry = $state.raw<ProjectDecision>();
  latest = $state.raw<ProjectDecision>();
  status = $state<CardStatus>('pending');
  uncertain = $state(false);
  private retry?: DecisionAnswer;
  private checking = 0;
  private readonly changed: () => Promise<void>;
  constructor(entry: ProjectDecision, changed: () => Promise<void>) {
    this.entry = entry;
    this.changed = changed;
  }
  sync(latest?: ProjectDecision) {
    this.latest = latest;
    if (this.status === 'sending' || ['answered', 'denied'].includes(this.status)) return;
    if (!latest) {
      const entry = this.entry!;
      const checking = ++this.checking;
      this.status = 'stale';
      void window.skaro
        .invoke('decisions.status', entry.origin.projectId, entry.id, entry.revision)
        .then((status) => {
          if (checking === this.checking && !this.latest && this.status !== 'sending')
            this.applyStatus(status);
        })
        .catch(() => undefined);
    } else if (latest.revision !== this.entry!.revision) this.status = 'stale';
    else this.entry = latest;
  }
  update() {
    if (this.uncertain) return;
    if (this.latest) {
      this.checking++;
      this.entry = this.latest;
      this.status = 'pending';
      this.retry = undefined;
    }
  }
  async answer(action: DecisionAnswer) {
    if (this.uncertain) return;
    if (this.status === 'sending') return;
    if (this.status !== 'pending' && this.status !== 'error') return;
    const entry = this.entry!;
    this.checking++;
    this.retry = action;
    this.status = 'sending';
    try {
      await window.skaro.invoke(
        'decisions.answer',
        entry.origin.projectId,
        entry.id,
        entry.revision,
        action,
      );
      this.status = decisionAnswerOutcome(action);
      this.retry = undefined;
      await this.changed();
      if (
        this.latest &&
        ((action.kind === 'merge' && !['confirm', 'cancel'].includes(action.action.action)) ||
          (action.kind === 'proposal' &&
            this.latest.kind === 'proposal' &&
            this.latest.item.state === 'accepted' &&
            this.latest.revision !== entry.revision))
      )
        this.update();
    } catch (error) {
      const message = String(error);
      if (/decision_reply_uncertain/.test(message)) {
        this.uncertain = true;
        this.status = 'error';
        await this.check();
      } else {
        this.status = /decision_(stale|answer_conflict)/.test(message) ? 'stale' : 'error';
        if (this.status === 'stale') await this.changed();
      }
    }
  }
  repeat() {
    if (this.uncertain) return this.check();
    return this.retry ? this.answer(this.retry) : Promise.resolve();
  }
  async check() {
    const entry = this.entry!;
    try {
      await this.changed();
      const checking = ++this.checking;
      const status = await window.skaro.invoke(
        'decisions.status',
        entry.origin.projectId,
        entry.id,
        entry.revision,
      );
      if (checking === this.checking && entry.revision === this.entry?.revision)
        this.applyStatus(status);
    } catch {
      this.status = 'error';
    }
  }
  private applyStatus(status: ReturnType<ProjectDecisionMethods['decisions.status']>) {
    this.uncertain = status === 'uncertain';
    this.status = status === 'uncertain' ? 'error' : status;
    if (['answered', 'denied'].includes(status)) this.retry = undefined;
  }
}
