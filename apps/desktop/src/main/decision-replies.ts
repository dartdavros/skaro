import type { AppDb } from '@skaro/core';
import {
  decisionAnswerOutcome,
  type DecisionAnswer,
  type ProjectDecision,
} from '../shared/project-decisions';
import { decisionHash } from './decision-projection';
import { withoutSecrets } from './session-log';
import { linkC4DecisionReply } from './c4-decision-recovery';

interface Receipt {
  revision: string;
  answer: string;
  outcome: 'answered' | 'denied';
  state: 'dispatching' | 'done' | 'uncertain';
}
export function decisionReplyStatus(db: AppDb, entry: ProjectDecision) {
  const receipt = db.getSetting<Receipt | undefined>(
    `coordination.decision-reply.v1.${entry.origin.projectId}.${decisionHash([entry.id, entry.revision])}`,
    undefined,
  );
  return receipt?.state === 'done' ? receipt.outcome : undefined;
}
/** Same durable receipt and in-flight promise for every presentation; unknown effects never retry blindly. */
export class DecisionReplies {
  private readonly running = new Map<string, { answer: string; promise: Promise<void> }>();
  private readonly db: AppDb;
  constructor(db: AppDb) {
    this.db = db;
  }
  status(entry: ProjectDecision) {
    return decisionReplyStatus(this.db, entry);
  }
  async accept(
    entry: ProjectDecision,
    answer: DecisionAnswer,
    verify: () => Promise<void>,
    effect: () => Promise<void>,
  ): Promise<void> {
    const nonterminal =
      answer.kind === 'merge' && !['confirm', 'cancel'].includes(answer.action.action)
        ? answer.action.action
        : undefined;
    const key = `coordination.decision-reply.v1.${entry.origin.projectId}.${decisionHash(nonterminal ? [entry.id, entry.revision, nonterminal] : [entry.id, entry.revision])}`;
    const mutex = JSON.stringify([entry.origin.projectId, entry.id]);
    const publicAnswer =
      answer.kind === 'respond' && entry.kind === 'interaction'
        ? { ...answer, answer: withoutSecrets(entry.interaction, answer.answer) }
        : answer;
    const hash = decisionHash(publicAnswer),
      liveHash = decisionHash(answer),
      current = this.running.get(mutex);
    if (current) {
      if (current.answer !== liveHash) throw new Error('decision_answer_conflict');
      return current.promise;
    }
    const promise = this.execute(
      key,
      entry,
      hash,
      decisionAnswerOutcome(answer),
      verify,
      effect,
      answer,
    );
    this.running.set(mutex, { answer: liveHash, promise });
    try {
      await promise;
    } finally {
      if (this.running.get(mutex)?.promise === promise) this.running.delete(mutex);
    }
  }
  private async execute(
    key: string,
    entry: ProjectDecision,
    hash: string,
    outcome: Receipt['outcome'],
    verify: () => Promise<void>,
    effect: () => Promise<void>,
    answer: DecisionAnswer,
  ) {
    const previous = this.db.getSetting<Receipt | undefined>(key, undefined, { strict: true });
    if (previous) {
      if (previous.revision !== entry.revision || previous.answer !== hash)
        throw new Error('decision_answer_conflict');
      if (previous.state === 'done') return;
      throw new Error('decision_reply_uncertain');
    }
    await verify();
    const receipt: Receipt = {
      revision: entry.revision,
      answer: hash,
      outcome,
      state: 'dispatching',
    };
    if (!this.db.settings.compareAndSet(key, undefined, receipt))
      throw new Error('decision_answer_conflict');
    try {
      linkC4DecisionReply(this.db, entry, answer, key, receipt);
      await effect();
      if (!this.db.settings.compareAndSet(key, receipt, { ...receipt, state: 'done' }))
        throw new Error('decision_reply_uncertain');
    } catch (error) {
      this.db.settings.compareAndSet(key, receipt, { ...receipt, state: 'uncertain' });
      throw error;
    }
  }
}
