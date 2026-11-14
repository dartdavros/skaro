import { createHash } from 'node:crypto';
import type { AppDb } from '@skaro/core';
import type { Interaction, TimelineEvent, TimelineState } from '@skaro/timeline';
type Question = Extract<Interaction, { kind: 'question' }>;
interface Retirement {
  hash: string;
  reason: string;
  at: number;
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
  cancel(question: Question, reason: string): void {
    if (question.delivery !== 'async' || !reason.trim())
      throw new Error(
        'Cancellation requires an exact saved async question and explicit owner reason.',
      );
    const records = this.db.getSetting<Record<string, Retirement>>(this.key, {});
    const hash = fingerprint(question);
    if (records[question.id]?.hash === hash) return;
    this.db.setSetting(this.key, { ...records, [question.id]: { hash, reason, at: Date.now() } });
  }
  recover(state: TimelineState, emit: (event: TimelineEvent) => void): void {
    const records = this.db.getSetting<Record<string, Retirement>>(this.key, {});
    for (const question of [...state.interactions])
      if (
        question.kind === 'question' &&
        question.delivery === 'async' &&
        records[question.id]?.hash === fingerprint(question)
      )
        emit({ t: 'interaction.closed', id: question.id, resolution: 'cancelled' });
  }
}
