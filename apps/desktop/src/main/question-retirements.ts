import { createHash } from 'node:crypto';
import type { AppDb } from '@skaro/core';
import {
  questionRequestEpoch,
  type Interaction,
  type TimelineEvent,
  type TimelineState,
} from '@skaro/timeline';
type Question = Extract<Interaction, { kind: 'question' }>;
interface Retirement {
  hash: string;
  reason: string;
  at: number;
  epoch?: string;
}
const fingerprint = (question: Question) =>
  createHash('sha256').update(JSON.stringify(question)).digest('hex');

/** Exact owner cancellations, distinct from answers, permissions and automatic expiry. */
export class QuestionRetirements {
  private readonly db: Pick<AppDb, 'getSetting' | 'setSetting'>;
  private readonly key: string;
  constructor(db: Pick<AppDb, 'getSetting' | 'setSetting'>, owner: string) {
    this.db = db;
    this.key = `question.retirements.${owner}`;
  }
  cancel(question: Question, reason: string, epoch?: string): void {
    if (!reason.trim() || (question.delivery !== 'async' && !epoch))
      throw new Error(
        'Cancellation requires an exact saved async question or native request epoch and explicit owner reason.',
      );
    const records = this.db.getSetting<Record<string, Retirement>>(this.key, {});
    const hash = fingerprint(question);
    if (records[question.id]?.hash === hash && records[question.id]?.epoch === epoch) return;
    this.db.setSetting(this.key, {
      ...records,
      [question.id]: { hash, reason, epoch, at: Date.now() },
    });
  }
  recover(state: TimelineState, emit: (event: TimelineEvent) => void): void {
    const records = this.db.getSetting<Record<string, Retirement>>(this.key, {});
    for (const question of [...state.interactions])
      if (
        question.kind === 'question' &&
        records[question.id]?.hash === fingerprint(question) &&
        (!records[question.id]?.epoch ||
          records[question.id]?.epoch === questionRequestEpoch(state, question))
      )
        emit({ t: 'interaction.closed', id: question.id, resolution: 'cancelled' });
  }
}
