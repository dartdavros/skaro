import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import type {
  AgentAdapter,
  AgentSession,
  Interaction,
  InteractionAnswer,
  PermissionMode,
  TimelineEvent,
} from '@skaro/timeline';
import type { Recorder } from './recorder.ts';

/** Skaro permission modes plus plan-first. */
export type PermissionLevel = PermissionMode | 'plan';

export interface ProbeOptions {
  workspace: string;
  permission: PermissionLevel;
  model?: string;
  effort?: string;
  sandboxVerified?: boolean;
  sandboxMode?: string;
}

export type Responder = (interaction: Interaction) => InteractionAnswer;

/** Allow once, pick the first option of every question, approve plans. */
export const allowAll: Responder = (interaction) => {
  switch (interaction.kind) {
    case 'question':
      return {
        kind: 'question',
        answers: Object.fromEntries(
          interaction.questions.map((q) => [q.id, [q.options[0]?.label ?? 'yes']]),
        ),
      };
    case 'plan_approval':
      return { kind: 'plan_approval', approve: true };
    case 'form':
      return { kind: 'form', action: 'decline' };
    case 'login':
      return { kind: 'login', action: 'cancel' };
    default:
      return { kind: 'approval', choice: 'allow_once' };
  }
};

/** A real adapter session driven by a scenario: answers interactions, records everything. */
export class ProbeSession {
  responder: Responder = allowAll;
  readonly events: TimelineEvent[] = [];
  private readonly bus = new EventEmitter();
  private readonly rec: Recorder;
  private readonly adapter: AgentAdapter;
  private readonly options: ProbeOptions;
  private session: AgentSession | undefined;
  private pump: Promise<void> | undefined;

  constructor(adapter: AgentAdapter, rec: Recorder, options: ProbeOptions) {
    this.adapter = adapter;
    this.rec = rec;
    this.options = options;
    this.bus.setMaxListeners(100);
  }

  get workspace(): string {
    return this.options.workspace;
  }

  async start(): Promise<void> {
    const o = this.options;
    this.rec.raw('meta', {
      event: 'start',
      agent: this.adapter.id,
      adapterVersion: this.adapter.adapterVersion,
      options: { ...o, workspace: undefined },
    });
    this.session = await this.adapter.start({
      cwd: o.workspace,
      permissionMode: o.permission === 'plan' ? 'ask' : o.permission,
      planFirst: o.permission === 'plan',
      ...(o.model ? { model: o.model } : {}),
      ...(o.effort ? { effort: o.effort } : {}),
      ...(o.sandboxVerified ? { sandboxVerified: true } : {}),
      ...(o.sandboxMode ? { sandboxMode: o.sandboxMode } : {}),
      raw: (line) => void this.rec.raw(line.dir, line.line),
      context: this.rec.ctx,
    });
    const session = this.session;
    this.pump = (async () => {
      for await (const event of session.events) {
        this.events.push(event);
        this.rec.canonical(event);
        this.bus.emit('event', event);
        if (event.t === 'interaction.opened' && event.interaction.kind !== 'merge') {
          const answer = this.responder(event.interaction);
          session.respond(event.interaction.id, answer).catch((error: unknown) => {
            this.rec.raw('meta', { event: 'respond-error', error: String(error) });
          });
        }
      }
    })();
  }

  send(text: string, images: string[] = []): Promise<void> {
    return this.require().send({ text, images: images.map((p) => resolve(this.workspace, p)) });
  }

  /** Sends a message and waits for the turn to complete. */
  async turn(text: string, images?: string[]): Promise<TimelineEvent> {
    const done = this.waitFor((e) => e.t === 'turn.completed');
    await this.send(text, images);
    return done;
  }

  async compact(): Promise<void> {
    const done = this.waitFor((e) => e.t === 'turn.completed', 5 * 60_000);
    await this.require().compact();
    await done;
  }

  interrupt(): Promise<void> {
    return this.require().interrupt();
  }

  /** Rewinds to before the n-th user message (1-based). */
  async rewind(beforeMessage: number): Promise<void> {
    const userMessages: string[] = [];
    for (const e of this.events) {
      if (
        e.t === 'item.upsert' &&
        e.item.kind === 'message' &&
        e.item.role === 'user' &&
        !userMessages.includes(e.item.id)
      ) {
        userMessages.push(e.item.id);
      }
    }
    const target = userMessages[beforeMessage - 1];
    if (!target) throw new Error('nothing to rewind to');
    await this.require().rewind(target);
  }

  async close(): Promise<void> {
    await this.session?.close();
    await this.pump;
  }

  waitFor(
    predicate: (event: TimelineEvent) => boolean,
    timeoutMs = 10 * 60_000,
  ): Promise<TimelineEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.bus.off('event', listener);
        reject(new Error(`timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      const listener = (event: TimelineEvent) => {
        if (!predicate(event)) return;
        clearTimeout(timer);
        this.bus.off('event', listener);
        resolve(event);
      };
      this.bus.on('event', listener);
    });
  }

  private require(): AgentSession {
    if (!this.session) throw new Error('session not started');
    return this.session;
  }
}
