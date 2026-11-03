import { createHash } from 'node:crypto';
import type { Item, TimelineEvent } from '@skaro/timeline';
import type { RuntimeJournal } from '../journal.ts';

type Step = { text: string; startedAt: number; complete: boolean };
/** Genuine deltas and canonical messages, batched before projection. No provider data is invented. */
export class ModelTextJournal {
  private readonly journal: RuntimeJournal;
  private readonly id: string;
  private readonly turnId: string;
  private readonly steps = new Map<string, Step>();
  private pieces: { requestId: string; text: string }[] = [];
  private bytes = 0;
  private serial = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private writes: Promise<unknown> = Promise.resolve();
  private failed = false;
  constructor(journal: RuntimeJournal, id: string, turnId: string) {
    this.journal = journal;
    this.id = id;
    this.turnId = turnId;
    for (const record of journal.records) {
      if (!record.id.startsWith(`model-text:${id}:`)) continue;
      const value = record.result.value as { requestId?: string; text?: string };
      if (!value.requestId || typeof value.text !== 'string') continue;
      const step = this.step(value.requestId, record.timestamp);
      step.text += value.text;
      this.bytes += Buffer.byteLength(value.text);
      this.serial++;
    }
    for (const [requestId, step] of this.steps)
      step.complete = !!journal.find(`model-message:${id}:${requestId}`);
  }
  private step(requestId: string, startedAt = Date.now()): Step {
    let value = this.steps.get(requestId);
    if (!value) this.steps.set(requestId, (value = { text: '', startedAt, complete: false }));
    return value;
  }
  private item(requestId: string, step: Step, status: Item['status'], final = false): Item {
    return {
      id: createHash('sha256').update(`${this.turnId}:${requestId}`).digest('hex'),
      turnId: this.turnId,
      startedAt: step.startedAt,
      status,
      ...(status !== 'running' ? { endedAt: Date.now() } : {}),
      kind: 'message',
      role: 'agent',
      text: step.text,
      phase: final ? 'final' : 'commentary',
      native: { agent: 'skaro', type: 'model-text', ref: requestId },
    };
  }
  write(requestId: string, text: string): void {
    this.bytes += Buffer.byteLength(text);
    if (this.failed || this.bytes > 8_388_608 || this.step(requestId).complete)
      throw new Error('Model text journal is unavailable');
    if (!text) return;
    this.pieces.push({ requestId, text });
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, 50);
  }
  private flush(): void {
    const batches: { requestId: string; text: string }[] = [];
    for (const piece of this.pieces.splice(0)) {
      const last = batches.at(-1);
      if (last?.requestId === piece.requestId) last.text += piece.text;
      else batches.push({ ...piece });
    }
    for (const { requestId, text } of batches) {
      const id = `model-text:${this.id}:${++this.serial}`;
      this.writes = this.writes.then(() => {
        const step = this.step(requestId);
        const initial = !step.text;
        step.text += text;
        const item = this.item(requestId, step, 'running');
        const event: TimelineEvent = initial
          ? { t: 'item.upsert', item }
          : { t: 'item.append', itemId: item.id, field: 'text', chunk: text };
        return this.journal.append(id, [{ type: 'timeline', event }], {
          value: { kind: 'model-text', requestId, text },
        });
      });
      void this.writes.catch(() => {
        this.failed = true;
      });
    }
  }
  async finishStep(requestId: string, fullText: string | undefined, final: boolean): Promise<void> {
    await this.close();
    const step = this.step(requestId);
    const source = this.journal.find(`${requestId}:result`);
    if (!source || source.result.error)
      throw new Error('Model message has no durable provider result');
    if (fullText !== undefined) {
      if (!fullText.startsWith(step.text))
        throw new Error('Model text differs from its durable response');
      if (fullText.length > step.text.length) {
        this.write(requestId, fullText.slice(step.text.length));
        await this.close();
      }
    }
    if (!step.text || step.complete) return;
    await this.journal.append(
      `model-message:${this.id}:${requestId}`,
      [
        {
          type: 'timeline',
          event: { t: 'item.upsert', item: this.item(requestId, step, 'done', final) },
        },
      ],
      {
        value: { kind: 'model-message', source: { sequence: source.sequence, hash: source.hash } },
      },
    );
    step.complete = true;
  }
  async fail(interrupted: boolean): Promise<void> {
    await this.close();
    for (const [requestId, step] of this.steps) {
      if (step.complete || !step.text) continue;
      await this.journal.append(`model-message-failed:${this.id}:${requestId}`, [
        {
          type: 'timeline',
          event: {
            t: 'item.upsert',
            item: this.item(requestId, step, interrupted ? 'interrupted' : 'failed'),
          },
        },
      ]);
    }
  }
  async close(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.flush();
    await this.writes;
  }
}
