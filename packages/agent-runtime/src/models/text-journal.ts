import type { RuntimeJournal } from '../journal.ts';

/** Genuine model text, batched for durable IO. Partial text never represents a successful call. */
export class ModelTextJournal {
  private readonly journal: RuntimeJournal;
  private readonly id: string;
  private pieces: string[] = [];
  private bytes = 0;
  private serial = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private writes: Promise<unknown> = Promise.resolve();
  private failed = false;
  constructor(journal: RuntimeJournal, id: string) {
    this.journal = journal;
    this.id = id;
  }
  write(text: string): void {
    this.bytes += Buffer.byteLength(text);
    if (this.failed || this.bytes > 8_388_608) throw new Error('Model text journal is unavailable');
    this.pieces.push(text);
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, 50);
  }
  private flush(): void {
    if (!this.pieces.length) return;
    const text = this.pieces.join('');
    this.pieces = [];
    const id = `model-text:${this.id}:${++this.serial}`;
    this.writes = this.writes.then(() =>
      this.journal.append(id, [], { value: { kind: 'model-text', text } }),
    );
    void this.writes.catch(() => {
      this.failed = true;
    });
  }
  async close(): Promise<void> {
    clearTimeout(this.timer);
    this.flush();
    await this.writes;
  }
}
