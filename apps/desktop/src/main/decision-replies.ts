import type { AppDb } from '@skaro/core';
import {
  decisionAnswerOutcome,
  type DecisionAnswer,
  type ProjectDecision,
} from '../shared/project-decisions';
import { decisionHash } from './decision-projection';
import { withoutSecrets } from './session-log';
import { linkC4DecisionReply } from './c4-decision-recovery';
import { DecisionNotDispatched } from './decision-not-dispatched';
import { incidentReplyProof } from './incident-reply-proof';
import { questionReplyProof } from './question-answer-proof';

const replyProof = (db: AppDb, entry: ProjectDecision, hash: string) =>
  incidentReplyProof(db, entry, hash) ?? questionReplyProof(db, entry, hash);

interface Receipt {
  revision: string;
  answer: string;
  outcome: 'answered' | 'denied';
  operation?: 'merge_confirm';
  state: 'dispatching' | 'done' | 'uncertain' | 'not_dispatched';
}
export function decisionReplyStatus(db: AppDb, entry: ProjectDecision) {
  const receipt = db.getSetting<Receipt | undefined>(
    `coordination.decision-reply.v1.${entry.origin.projectId}.${decisionHash([entry.id, entry.revision])}`,
    undefined,
  );
  if (!receipt) return;
  if (receipt.state === 'done') return receipt.outcome;
  const proof = replyProof(db, entry, receipt.answer);
  return proof === 'answered' || proof === 'denied' ? proof : undefined;
}
export function decisionReplyUncertain(db: AppDb, entry: ProjectDecision): boolean {
  const receipt = db.getSetting<Receipt | undefined>(
    `coordination.decision-reply.v1.${entry.origin.projectId}.${decisionHash([entry.id, entry.revision])}`,
    undefined,
    { strict: true },
  );
  return (
    !!receipt &&
    receipt.operation !== 'merge_confirm' &&
    ['dispatching', 'uncertain'].includes(receipt.state) &&
    !replyProof(db, entry, receipt.answer)
  );
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
      if (current.answer !== liveHash) throw new DecisionNotDispatched('decision_answer_conflict');
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
    // Task publication reconciles its durable Git candidate before attempting a merge.
    const mergeConfirmation =
      entry.kind === 'interaction' &&
      entry.interaction.kind === 'merge' &&
      answer.kind === 'merge' &&
      answer.action.action === 'confirm';
    const previous = this.db.getSetting<Receipt | undefined>(key, undefined, { strict: true });
    if (previous) {
      const proof = replyProof(this.db, entry, previous.answer);
      const notDispatched = previous.state === 'not_dispatched' || proof === 'not_dispatched';
      if (previous.revision !== entry.revision || (previous.answer !== hash && !notDispatched))
        throw new DecisionNotDispatched('decision_answer_conflict');
      if (previous.state === 'done') return;
      if (proof === 'answered' || proof === 'denied') {
        if (!this.db.settings.compareAndSet(key, previous, { ...previous, state: 'done' }))
          throw new Error('decision_reply_uncertain');
        return;
      }
      if (!notDispatched && !mergeConfirmation)
        throw new DecisionNotDispatched('decision_reply_uncertain');
    }
    try {
      await verify();
    } catch (error) {
      throw new DecisionNotDispatched(error);
    }
    const receipt: Receipt = {
      revision: entry.revision,
      answer: hash,
      outcome,
      ...(mergeConfirmation ? { operation: 'merge_confirm' } : {}),
      state: 'dispatching',
    };
    if (!this.db.settings.compareAndSet(key, previous, receipt))
      throw new DecisionNotDispatched('decision_answer_conflict');
    try {
      linkC4DecisionReply(this.db, entry, answer, key, receipt);
      await effect();
      if (!this.db.settings.compareAndSet(key, receipt, { ...receipt, state: 'done' }))
        throw new Error('decision_reply_uncertain');
    } catch (error) {
      const proof = replyProof(this.db, entry, hash);
      const committed = proof === 'answered' || proof === 'denied';
      this.db.settings.compareAndSet(key, receipt, {
        ...receipt,
        state: committed
          ? 'done'
          : error instanceof DecisionNotDispatched
            ? 'not_dispatched'
            : 'uncertain',
      });
      if (committed) return;
      throw error;
    }
  }
}
