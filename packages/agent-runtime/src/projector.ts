import type { Emit, Projector } from '@skaro/timeline';
import type { JournalRecord } from './model.ts';

/** Derived feed only. Never interprets text as successful execution or acceptance. */
export class SkaroProjector implements Projector {
  private sequence = 0;
  private readonly emit: Emit;
  constructor(emit: Emit) {
    this.emit = emit;
  }
  input(): void {
    throw new Error('Skaro projects primary journal records, not raw user transport');
  }
  output(value: unknown): void {
    const record = value as JournalRecord;
    if (record.schema !== 2) throw new Error('Unsupported Skaro journal projection version');
    if (record.sequence <= this.sequence) return;
    if (record.sequence !== this.sequence + 1) throw new Error('Missing primary journal record');
    for (const fact of record.facts) if (fact.type === 'timeline') this.emit(fact.event);
    this.sequence = record.sequence;
  }
}
