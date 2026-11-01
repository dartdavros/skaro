import { createHash } from 'node:crypto';
import type { TimelineEvent } from '@skaro/timeline';
import type { RuntimeJournal } from '../journal.ts';
import type { RuntimeFact, CommandResult } from '../model.ts';

export class ModelTurnTimeline {
  readonly turnId: string;
  private readonly journal: RuntimeJournal;
  private readonly hash: string;
  private readonly startId: string;
  constructor(journal: RuntimeJournal, commandId: string, hash: string, startId?: string) {
    this.journal = journal;
    this.hash = hash;
    this.startId = startId ?? `model-lifecycle:${commandId}:started`;
    this.turnId = createHash('sha256')
      .update(`${journal.state.config!.sessionId}:${commandId}`)
      .digest('hex');
  }
  async begin(facts: RuntimeFact[] = [], result: CommandResult = {}) {
    const id = this.startId;
    const previous = this.journal.find(id);
    if (previous && previous.requestHash !== this.hash)
      throw new Error('Model lifecycle identity reused');
    return this.journal.append(
      id,
      [
        { type: 'timeline', event: { t: 'turn.started', turnId: this.turnId } },
        { type: 'timeline', event: { t: 'activity', state: 'waiting_model' } },
        ...facts,
      ],
      result,
      this.hash,
    );
  }
  terminal(outcome: 'done' | 'failed' | 'interrupted', error?: string): RuntimeFact[] {
    const event: TimelineEvent = {
      t: 'turn.completed',
      turnId: this.turnId,
      outcome,
      ...(error && outcome === 'failed' ? { error: { category: 'other', message: error } } : {}),
    };
    return [{ type: 'timeline', event }];
  }
}
