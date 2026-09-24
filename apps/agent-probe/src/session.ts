import { EventEmitter } from 'node:events';
import type { Interaction, InteractionAnswer, TimelineEvent } from '@skaro/timeline';
import type { Recorder } from './recorder.ts';

/** Skaro permission modes (docs/agent-output.md, 5.3) plus plan-first. */
export type PermissionLevel = 'ask' | 'auto' | 'full' | 'plan';

export interface SessionOptions {
  workspace: string;
  permission: PermissionLevel;
  model?: string;
  effort?: string;
  /** Run with an empty agent config dir to reproduce "not logged in". */
  authMissing?: boolean;
  /** Claude: enable the Bash sandbox with auto-allow. */
  sandbox?: boolean;
  /** Codex: opt into the experimental API (needed for plan mode and user-input questions). */
  experimental?: boolean;
  /** Codex: `-c key=value` config overrides for the app-server process. */
  codexConfig?: string[];
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
    default:
      return { kind: 'approval', choice: 'allow_once' };
  }
};

/** Driver of one agent session, as the probe scenarios see it. */
export abstract class ProbeSession {
  responder: Responder = allowAll;
  readonly events: TimelineEvent[] = [];
  private readonly bus = new EventEmitter();
  protected readonly rec: Recorder;
  protected readonly options: SessionOptions;

  constructor(rec: Recorder, options: SessionOptions) {
    this.rec = rec;
    this.options = options;
    this.bus.setMaxListeners(100);
  }

  get workspace(): string {
    return this.options.workspace;
  }

  abstract start(): Promise<void>;
  /** Sends a user message without waiting for the turn to finish. */
  abstract send(text: string, images?: string[]): Promise<void>;
  abstract interrupt(): Promise<void>;
  abstract compact(): Promise<void>;
  /** Rewinds files and conversation to the state before the n-th sent message (1-based). */
  abstract rewind(beforeMessage: number): Promise<void>;
  abstract close(): Promise<void>;

  /** Approves a plan the agent proposed without asking (Codex). Claude asks via ExitPlanMode. */
  async approvePlan(): Promise<void> {}

  /** Sends a message and waits for the turn to complete. */
  async turn(text: string, images?: string[]): Promise<TimelineEvent> {
    const done = this.waitFor((e) => e.t === 'turn.completed');
    await this.send(text, images);
    return done;
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

  protected publish(event: TimelineEvent): void {
    this.events.push(event);
    this.rec.canonical(event);
    this.bus.emit('event', event);
  }
}

/** Splits a byte stream into lines. */
export function lineSplitter(onLine: (line: string) => void): (chunk: Buffer | string) => void {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString();
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      if (line.trim()) onLine(line);
    }
  };
}

export function parseJson(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return line;
  }
}
