import { createHash } from 'node:crypto';
import type { TimelineEvent } from '@skaro/timeline';
import type { RuntimeJournal } from '../journal.ts';
import type { RuntimeFact } from '../model.ts';

export class ModelTurnTimeline {
  readonly turnId: string;
  private readonly journal: RuntimeJournal;
  private readonly commandId: string;
  private readonly hash: string;
  constructor(journal: RuntimeJournal, commandId: string, hash: string) {
    this.journal = journal;
    this.commandId = commandId;
    this.hash = hash;
    this.turnId = createHash('sha256')
      .update(`${journal.state.config!.sessionId}:${commandId}`)
      .digest('hex');
  }
  async begin(): Promise<void> {
    const id = `model-lifecycle:${this.commandId}:started`;
    const previous = this.journal.find(id);
    if (previous && previous.requestHash !== this.hash)
      throw new Error('Model lifecycle identity reused');
    await this.journal.append(
      id,
      [
        { type: 'timeline', event: { t: 'turn.started', turnId: this.turnId } },
        { type: 'timeline', event: { t: 'activity', state: 'waiting_model' } },
      ],
      {},
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
