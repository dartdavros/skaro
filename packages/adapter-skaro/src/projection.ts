import { SkaroProjector, type JournalRecord } from '@skaro/agent-runtime';
import type { BuiltinSessionOptions, Emit } from '@skaro/timeline';

/** Prime from the primary journal while delivering only records absent from the host's raw log. */
export class SessionProjection {
  private readonly projector: SkaroProjector;
  private readonly boundary;
  private readonly raw: BuiltinSessionOptions['raw'];
  private publishing = false;
  constructor(options: BuiltinSessionOptions, emit: Emit) {
    this.raw = options.raw;
    this.boundary = structuredClone(
      options.journalReplay ?? {
        sessionId: options.config.sessionId,
        sequence: 0,
        hash: '',
      },
    );
    const value = this.boundary;
    if (
      value.sessionId !== options.config.sessionId ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 0 ||
      (value.sequence === 0 ? value.hash !== '' : !/^[a-f0-9]{64}$/.test(value.hash))
    )
      throw new Error('Invalid primary journal replay boundary');
    this.projector = new SkaroProjector((event) => {
      if (this.publishing) emit(event);
    });
  }
  ready(records: readonly JournalRecord[]) {
    const { sequence, hash } = this.boundary;
    if (sequence > records.length || (sequence ? records[sequence - 1]?.hash : '') !== hash)
      throw new Error('Host replay boundary differs from the primary journal');
    for (const record of records) this.record(record);
  }
  record(record: JournalRecord) {
    if (record.sessionId !== this.boundary.sessionId)
      throw new Error('Projection received another primary journal');
    this.publishing = record.sequence > this.boundary.sequence;
    if (this.publishing) this.raw({ ts: record.timestamp, dir: 'out', line: record });
    this.projector.output(record);
  }
}
