import { operationTimeout, type TimelineState } from '@skaro/timeline';
import type { Events, EventName } from '../shared/ipc';
import type { HistorySource, HistoryView, HistoryOrigin } from '../shared/history';
import { background } from './background/client';
import { captureHistory, uploadHistory } from './history-upload';
import { TaskHistoryReads } from './history-task-reads';
import { HISTORY_VERSION } from '../shared/history';
import { chatC4Timeline } from './chat-c4-timeline';

/** Serialize read-model updates per conversation, independently of command delivery. */
export class HistoryReads {
  readonly dataDir: string;
  private readonly emit: <E extends EventName>(name: E, value: Events[E]) => void;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly sequences = new Map<string, number>();
  private readonly tasks: TaskHistoryReads;
  constructor(dataDir: string, emit: <E extends EventName>(name: E, value: Events[E]) => void) {
    this.dataDir = dataDir;
    this.emit = emit;
    this.tasks = new TaskHistoryReads(dataDir, (owner, action) => this.queue(owner, action), emit);
  }
  private queue<T>(owner: string, action: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(owner) ?? Promise.resolve())
      .catch(() => undefined)
      .then(action);
    this.queues.set(owner, result);
    void result
      .finally(() => {
        if (this.queues.get(owner) === result) this.queues.delete(owner);
      })
      .catch(() => undefined);
    return result;
  }
  sync(owner: string, seq: number, state: TimelineState): Promise<HistoryView> {
    // A snapshot owns array membership while native events continue replacing immutable items.
    const snapshot = captureHistory(state);
    return this.queue(owner, async () => {
      const known = Math.max(seq, this.sequences.get(owner) ?? -1);
      const cached = await background(
        this.dataDir,
        'read.match',
        owner,
        `${HISTORY_VERSION}:${known}`,
      );
      if (cached) {
        this.sequences.set(owner, known);
        return this.initial(cached);
      }
      const view = await uploadHistory(this.dataDir, owner, `${HISTORY_VERSION}:${seq}`, snapshot);
      this.sequences.set(owner, seq);
      return this.initial(view);
    });
  }
  reset(owner: string, seq: number, state: TimelineState): Promise<void> {
    return this.queue(owner, async () => {
      this.tasks.forget(owner);
      const view = await uploadHistory(
        this.dataDir,
        owner,
        `${HISTORY_VERSION}:${seq}`,
        state,
        undefined,
        true,
      );
      this.sequences.set(owner, seq);
      this.emit('history.changed', { owner, view: await this.initial(view) });
    });
  }
  async peek(owner: string, path: string, subject: number) {
    const saved = await this.queue(owner, () =>
      background(this.dataDir, 'read.peek', owner, path, subject),
    );
    if (!saved) return;
    this.sequences.set(owner, saved.seq);
    return { ...saved, view: await this.initial(saved.view) };
  }
  certify(source: HistorySource, path: string, subject: number) {
    return this.queue(source.owner, () =>
      background(this.dataDir, 'read.certify', source, path, subject),
    );
  }
  syncTask(
    owner: string,
    runId: string,
    revision: string,
    origins: HistoryOrigin[],
    state: TimelineState,
  ) {
    return this.tasks
      .sync(owner, runId, revision, origins, state)
      .then((view) => this.initial(view));
  }
  private async initial(view: HistoryView): Promise<HistoryView> {
    const last = Math.floor(Math.max(0, view.source.count - 1) / 16) * 16;
    const page = await this.page(view.source, Math.max(0, last - 16), 32);
    return this.projectChat({ ...view, page });
  }
  private async projectChat(view: HistoryView): Promise<HistoryView> {
    const owner = /^([^:]+):chat:([^:]+)$/.exec(view.source.owner);
    if (!owner) return view;
    const projectId = owner[1]!;
    const chatId = owner[2]!;
    const records = await operationTimeout(
      background(this.dataDir, 'c4.list', projectId, chatId),
      5000,
      'Project chat decision projection timed out',
    );
    return { ...view, timeline: chatC4Timeline(projectId, chatId, view.timeline, records) };
  }
  observe<E extends EventName>(name: E, value: Events[E]): void {
    this.tasks.observe(name, value);
    if (name !== 'chat.events') return;
    const batch = value as Events['chat.events'];
    const owner = `${batch.projectId}:chat:${batch.chatId}`;
    if (!this.sequences.has(owner) && !this.queues.has(owner)) return;
    void this.queue(owner, async () => {
      const seq = this.sequences.get(owner) ?? batch.seq;
      const fresh = batch.events.slice(Math.max(0, seq - batch.seq));
      if (!fresh.length) return;
      if (batch.seq > seq) throw new Error('Read-model event sequence gap');
      const next = batch.seq + batch.events.length;
      const view = await background(
        this.dataDir,
        'read.events',
        owner,
        fresh,
        `${HISTORY_VERSION}:${next}`,
      );
      if (!view) return;
      this.sequences.set(owner, next);
      this.emit('history.changed', { owner, view: await this.projectChat(view) });
    }).catch((error: unknown) => {
      console.error('History read model:', error);
      this.sequences.delete(owner);
      this.emit('history.changed', { owner, error: String(error) });
    });
  }
  page(source: HistorySource, start: number, limit: number) {
    return background(this.dataDir, 'read.page', source, start, limit);
  }
  changes(source: HistorySource, start: number) {
    return background(this.dataDir, 'read.changes', source, start);
  }
  find(source: HistorySource, id: string) {
    return background(this.dataDir, 'read.find', source, id);
  }
  copy(source: HistorySource, pending?: import('../shared/history').HistoryPending[]) {
    return background(this.dataDir, 'read.copy', source, pending);
  }
  async close(): Promise<void> {
    await Promise.allSettled(this.queues.values());
  }
}

let reads: HistoryReads | undefined;
export const setHistoryReads = (value: HistoryReads) => {
  reads = value;
};
export function historyReads(): HistoryReads {
  if (!reads) throw new Error('History read service is not ready');
  return reads;
}
