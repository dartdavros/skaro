import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { background } from './background/client';
import { presentationEvent } from './timeline-presentation';
import { SessionSecrets } from './private-input';
import { scopeTimeline } from '../shared/task-timeline';
import { dirname, join } from 'node:path';
import {
  Timeline,
  runEvent,
  currentActivity,
  type TimelineEvent,
  type TimelineState,
  type RawLine,
} from '@skaro/timeline';
import {
  integrationParticipants,
  participatesIn,
  type IntegrationOperation,
} from './integration-model';
import type { IntegrationStore } from './integration-store';
import { IntegrationRawLog } from './integration-raw-log';
import { composeTaskTimeline, type IntegrationTimeline } from '../shared/task-timeline';
import type { Events } from '../shared/ipc';
import { inBackground, abandoned } from './integration-history-state';

interface Journal {
  secrets: SessionSecrets;
  pending: TimelineEvent[];
  snapshot: Promise<{ timeline: Timeline; seq: number }>;
  writing?: Promise<void>;
  timer?: NodeJS.Timeout;
  raw?: IntegrationRawLog;
  error?: unknown;
}

/** One ordered journal and incremental projection per candidate; UI receives committed batches. */
export class IntegrationHistory {
  private readonly journals = new Map<string, Journal>();
  private readonly store: IntegrationStore;
  private readonly changed: (projectId: string, taskId: string) => void;
  private readonly emit?: (batch: Events['integration.events']) => void;
  private readonly projectQuestions: (
    op: IntegrationOperation,
    state: TimelineState,
  ) => TimelineState;
  constructor(
    store: IntegrationStore,
    changed: (projectId: string, taskId: string) => void,
    emit?: (batch: Events['integration.events']) => void,
    projectQuestions: (op: IntegrationOperation, state: TimelineState) => TimelineState = (
      _op,
      state,
    ) => state,
  ) {
    this.store = store;
    this.changed = changed;
    this.emit = emit;
    this.projectQuestions = projectQuestions;
  }

  private path(op: IntegrationOperation): string {
    return join(this.store.dataDir, 'integrations', op.projectId, op.id, 'events.jsonl');
  }

  private journal(op: IntegrationOperation): Journal {
    let journal = this.journals.get(op.id);
    if (!journal) {
      journal = {
        secrets: new SessionSecrets(),
        pending: [],
        snapshot: background(this.store.dataDir, 'history.canonical', this.path(op), '').then(
          (snapshot) => ({
            timeline: Timeline.restore(snapshot.timeline),
            seq: snapshot.seq,
          }),
        ),
      };
      this.journals.set(op.id, journal);
      const created = journal;
      void journal.snapshot.catch((error: unknown) => {
        created.error = error;
      });
    }
    return journal;
  }

  raw(op: IntegrationOperation, line: RawLine | Uint8Array): void {
    const journal = this.journal(op);
    journal.raw ??= new IntegrationRawLog(join(dirname(this.path(op)), 'raw.jsonl'));
    journal.raw.append(line instanceof Uint8Array ? line : journal.secrets.redact(line));
  }

  /** Live producers never wait for one filesystem round trip per token or output line. */
  enqueue(op: IntegrationOperation, event: TimelineEvent): void {
    const journal = this.journal(op);
    if (journal.error) throw journal.error;
    journal.pending.push(journal.secrets.redact(event));
    if (journal.pending.length >= 256 && !journal.writing) {
      clearTimeout(journal.timer);
      journal.timer = undefined;
      void this.flush(op, journal).catch((error: unknown) => {
        journal.error = error;
      });
    } else if (!journal.timer && !journal.writing) this.schedule(op, journal, 40);
  }

  private schedule(op: IntegrationOperation, journal: Journal, delay: number): void {
    clearTimeout(journal.timer);
    journal.timer = setTimeout(() => {
      journal.timer = undefined;
      void this.flush(op, journal).catch((error: unknown) => {
        journal.error = error;
      });
    }, delay);
  }

  private flush(op: IntegrationOperation, journal: Journal): Promise<void> {
    if (journal.writing) return journal.writing;
    if (!journal.pending.length) return Promise.resolve();
    const events = journal.pending.splice(0, 256);
    journal.writing = (async () => {
      const snapshot = await journal.snapshot;
      await mkdir(dirname(this.path(op)), { recursive: true });
      await appendFile(this.path(op), events.map((event) => JSON.stringify(event) + '\n').join(''));
      const before = currentActivity(snapshot.timeline.state);
      const seq = snapshot.seq;
      const scoped = events.map((event) =>
        presentationEvent(runEvent(event, `integration-${op.id}`)),
      );
      for (const event of events) snapshot.timeline.apply(event);
      snapshot.seq += events.length;
      op.sequence = snapshot.seq;
      this.store.save(op);
      const participants = integrationParticipants(op);
      for (const taskId of participants)
        this.emit?.({ projectId: op.projectId, taskId, integrationId: op.id, seq, events: scoped });
      if (
        before !== currentActivity(snapshot.timeline.state) ||
        events.some(
          (event) =>
            event.t === 'interaction.opened' ||
            event.t === 'interaction.closed' ||
            event.t === 'turn.started' ||
            event.t === 'turn.completed',
        )
      )
        for (const taskId of participants) this.changed(op.projectId, taskId);
    })()
      .catch((error: unknown) => {
        journal.error = error;
        throw error;
      })
      .finally(() => {
        journal.writing = undefined;
        if (journal.pending.length && !journal.error) this.schedule(op, journal, 0);
      });
    return journal.writing;
  }

  async drain(op: IntegrationOperation): Promise<void> {
    const journal = this.journal(op);
    do {
      clearTimeout(journal.timer);
      journal.timer = undefined;
      if (journal.error) throw journal.error;
      await this.flush(op, journal);
    } while (journal.pending.length || journal.writing);
    await journal.raw?.drain();
  }

  async event(op: IntegrationOperation, event: TimelineEvent): Promise<void> {
    this.enqueue(op, event);
    await this.drain(op);
  }

  async close(op: IntegrationOperation): Promise<void> {
    if (!this.journals.has(op.id)) return;
    await this.drain(op);
    const journal = this.journal(op);
    await journal.raw?.close();
    journal.raw = undefined;
  }

  async notice(op: IntegrationOperation, text: string, error = false): Promise<void> {
    await this.drain(op);
    await this.event(op, {
      t: 'item.upsert',
      item: {
        id: `notice-${op.sequence}`,
        turnId: '',
        kind: 'notice',
        code: 'other',
        level: error ? 'error' : 'info',
        text,
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'integration', ref: op.id },
      },
    });
  }

  /** What Skaro is doing with the candidate; a repeated execution does not say it again. */
  async announce(op: IntegrationOperation, text: string): Promise<void> {
    await this.drain(op);
    const last = (await this.journal(op).snapshot).timeline.state.items.findLast(
      (item) => item.kind === 'notice' && item.native.agent === 'skaro' && item.level === 'info',
    );
    if (last?.kind === 'notice' && last.text === text) return;
    await this.notice(op, text);
  }

  private async readEvents(op: IntegrationOperation): Promise<TimelineEvent[]> {
    const text = await readFile(this.path(op), 'utf8').catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    });
    return text
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as TimelineEvent];
        } catch {
          return [];
        }
      });
  }

  async events(op: IntegrationOperation): Promise<TimelineEvent[]> {
    await this.drain(op);
    return this.readEvents(op);
  }

  /** What the agent of the candidate does now, as its feed says it. */
  async activity(op: IntegrationOperation) {
    return currentActivity((await this.journal(op).snapshot).timeline.state);
  }

  async project(projectId: string, taskId: string, base?: TimelineState, hidden: string[] = []) {
    const operations = this.store
      .all(projectId)
      .filter((op) => participatesIn(op, taskId) && !hidden.includes(op.id));
    const sources: IntegrationTimeline[] = [];
    for (const op of operations) {
      const snapshot = await this.journal(op).snapshot;
      sources.push({
        id: op.id,
        seq: snapshot.seq,
        live: !!op.worker,
        ...(op.nativeAgent ? { agent: op.nativeAgent } : {}),
        ...(op.nativeEffort ? { effort: op.nativeEffort } : {}),
        timeline: scopeTimeline(
          this.projectQuestions(op, snapshot.timeline.state),
          `integration-${op.id}`,
        ),
      });
    }
    return {
      timeline: composeTaskTimeline(base, sources),
      sources: { base, integrations: sources },
      revision: operations.map((op) => `${op.id}:${op.state}:${op.worker ?? ''}`).join('|'),
    };
  }

  async recover(op: IntegrationOperation): Promise<void> {
    const timeline = await this.state(op);
    for (const interaction of timeline.state.interactions)
      if (interaction.kind !== 'merge' && interaction.kind !== 'question')
        await this.event(op, {
          t: 'interaction.closed',
          id: interaction.id,
          resolution: 'expired',
        });
    for (const turn of timeline.state.turns)
      if (!turn.outcome)
        await this.event(op, { t: 'turn.completed', turnId: turn.id, outcome: 'interrupted' });
    for (const item of timeline.state.items)
      if (item.status === 'running' || inBackground(item))
        await this.event(op, { t: 'item.upsert', item: abandoned(item) });
  }

  /** Skaro stops the process tree of a finished resolver: its background commands ended too. */
  async settleBackground(op: IntegrationOperation): Promise<void> {
    for (const item of (await this.state(op)).state.items)
      if (inBackground(item)) await this.event(op, { t: 'item.upsert', item: abandoned(item) });
  }
  async state(op: IntegrationOperation): Promise<Timeline> {
    await this.drain(op);
    return (await this.journal(op).snapshot).timeline;
  }
  secrets(op: IntegrationOperation): SessionSecrets {
    return this.journal(op).secrets;
  }
}
