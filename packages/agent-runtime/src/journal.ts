import { createHash } from 'node:crypto';
import { mkdir, open, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RuntimeProcessIdentity } from '@skaro/timeline';
import { JournalLock } from './journal-lock.ts';
import { emptyRuntimeState, reduceRuntimeRecord } from './state.ts';
import type { CommandResult, JournalRecord, RuntimeFact, RuntimeState } from './model.ts';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class RuntimeJournal {
  readonly records: JournalRecord[] = [];
  state: RuntimeState = emptyRuntimeState();
  private readonly ids = new Map<string, JournalRecord>();
  private closed = false;
  private closing?: Promise<void>;
  private failed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(record: JournalRecord) => void>();
  subscribe(listener: (record: JournalRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private readonly file: FileHandle;
  private readonly lock: JournalLock;
  private readonly sessionId: string;
  private constructor(file: FileHandle, lock: JournalLock, sessionId: string) {
    this.file = file;
    this.lock = lock;
    this.sessionId = sessionId;
  }

  static async open(
    path: string,
    sessionId: string,
    owner: RuntimeProcessIdentity,
  ): Promise<RuntimeJournal> {
    if (!sessionId || !path) throw new Error('Journal identity/path required');
    await mkdir(dirname(path), { recursive: true });
    const lock = await JournalLock.acquire(`${path}.index.sqlite`, owner);
    let file: FileHandle | undefined;
    try {
      file = await open(path, 'a+', 0o600);
      const journal = new RuntimeJournal(file, lock, sessionId);
      const bytes = await file.readFile();
      const boundary = bytes.lastIndexOf(10) + 1;
      // An unacknowledged torn tail cannot have admitted the next effect.
      const lines = bytes.subarray(0, boundary).toString('utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        const record = JSON.parse(line) as JournalRecord;
        const { hash, ...payload } = record;
        if (
          record.schema !== 2 ||
          record.sessionId !== sessionId ||
          record.sequence !== journal.records.length + 1 ||
          journal.ids.has(record.id) ||
          record.previous !== (journal.records.at(-1)?.hash ?? '') ||
          digest(payload) !== hash
        )
          throw new Error('Invalid or incompatible runtime journal');
        journal.accept(record);
      }
      if (boundary !== bytes.length) {
        // Windows append-only handles cannot truncate. Repair uses a separate writable
        // handle while the same verified journal ownership is still held.
        lock.assertOwned();
        const repair = await open(path, 'r+');
        try {
          await repair.truncate(boundary);
          await repair.sync();
        } finally {
          await repair.close();
        }
      }
      lock.checkpoint(journal.records.length, journal.records.at(-1)?.hash ?? '', journal.state);
      return journal;
    } catch (error) {
      await file?.close();
      lock.close();
      throw error;
    }
  }

  find(id: string): JournalRecord | undefined {
    return this.ids.get(id);
  }

  /** Caller serializes commands. Durable record precedes reply, event delivery and next effect. */
  append(
    id: string,
    facts: RuntimeFact[],
    result: CommandResult = {},
    requestHash?: string,
  ): Promise<JournalRecord> {
    if (this.closing) return Promise.reject(new Error('Journal is closing'));
    const work = this.queue.then(() => this.commit(id, facts, result, requestHash));
    this.queue = work.catch(() => undefined);
    return work;
  }

  private async commit(
    id: string,
    facts: RuntimeFact[],
    result: CommandResult = {},
    requestHash?: string,
  ): Promise<JournalRecord> {
    if (this.closed || this.failed) throw new Error('Journal closed or failed');
    if (!id) throw new Error('Record identity required');
    const existing = this.find(id);
    if (existing) return existing;
    this.lock.assertOwned();
    const payload = {
      schema: 2 as const,
      sessionId: this.sessionId,
      sequence: this.records.length + 1,
      id,
      timestamp: Date.now(),
      previous: this.records.at(-1)?.hash ?? '',
      facts: structuredClone(facts),
      result: structuredClone(result),
      ...(requestHash ? { requestHash } : {}),
    };
    const record = { ...payload, hash: digest(payload) };
    const next = reduceRuntimeRecord(this.state, record);
    try {
      await this.file.writeFile(JSON.stringify(record) + '\n');
      await this.file.sync();
    } catch (error) {
      this.failed = true;
      throw error;
    }
    this.records.push(record);
    this.ids.set(id, record);
    this.state = next;
    this.lock.checkpoint(record.sequence, record.hash, next);
    for (const listener of this.listeners) listener(record);
    return record;
  }

  private accept(record: JournalRecord): void {
    this.state = reduceRuntimeRecord(this.state, record);
    this.records.push(record);
    this.ids.set(record.id, record);
  }

  close(): Promise<void> {
    this.closing ??= this.closeOnce();
    return this.closing;
  }
  private async closeOnce(): Promise<void> {
    if (this.closed) return;
    await this.queue;
    this.closed = true;
    try {
      await this.file.close();
    } finally {
      this.lock.close();
    }
  }
}
