import {
  decisionAnswerOutcome,
  type DecisionAnswer,
  type ProjectDecision,
} from '../../../shared/project-decisions';

export type CardStatus =
  'pending' | 'sending' | 'error' | 'stale' | 'expired' | 'answered' | 'denied';
export class DecisionCardState {
  entry = $state.raw<ProjectDecision>();
  latest = $state.raw<ProjectDecision>();
  status = $state<CardStatus>('pending');
  private retry?: DecisionAnswer;
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
      this.status = 'stale';
      void window.skaro
        .invoke('decisions.status', entry.origin.projectId, entry.id, entry.revision)
        .then((status) => {
          if (!this.latest && this.status !== 'sending') this.status = status;
        })
        .catch(() => undefined);
    } else if (latest.revision !== this.entry!.revision) this.status = 'stale';
    else this.entry = latest;
  }
  update() {
    if (this.latest) {
      this.entry = this.latest;
      this.status = 'pending';
      this.retry = undefined;
    }
  }
  async answer(action: DecisionAnswer) {
    if (this.status === 'sending') return;
    if (this.status !== 'pending' && this.status !== 'error') return;
    const entry = this.entry!;
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
      this.status = /decision_(stale|answer_conflict|reply_uncertain)/.test(message)
        ? 'stale'
        : 'error';
    }
  }
  repeat() {
    return this.retry ? this.answer(this.retry) : Promise.resolve();
  }
}
