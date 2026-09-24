// Agent adapter contract (docs/architecture.md 5.1, agent-output.md section 3).
// Adapters implement it; the rest of Skaro never sees native agent formats.

import type { InteractionAnswer, TimelineEvent } from './model.ts';
import type { ProjectionContext } from './projection.ts';
import type { RawLine } from './replay.ts';

/** Skaro permission modes (architecture.md 5.4). */
export type PermissionMode = 'ask' | 'auto' | 'full';

export interface UserInput {
  text: string;
  /** Absolute paths of attached images. */
  images?: string[];
}

export interface McpServer {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export interface SessionOptions {
  /** Worktree of the task, or the project root for chats. */
  cwd: string;
  model?: string;
  effort?: string;
  permissionMode: PermissionMode;
  /** Explore and propose a plan first; edits start after the plan is approved (D-24). */
  planFirst?: boolean;
  /** Project and task chats read code only (architecture.md 9). */
  readOnly?: boolean;
  /** Native session to continue (Claude session id, Codex thread id). */
  resume?: string;
  /** Extra instructions for every turn (project rules, Skaro workflow). */
  instructions?: string;
  mcpServers?: Record<string, McpServer>;
  /** Whether the agent sandbox holds the workspace boundary (self-check, D-28). */
  sandboxVerified?: boolean;
  /** Agent-specific sandbox setting chosen by the self-check (Codex on Windows: elevated/unelevated). */
  sandboxMode?: string;
  /** Receives every native line, before parsing (principle P2). */
  raw: (line: RawLine) => void;
  /** Time and attachments for the projection. */
  context: ProjectionContext;
}

export interface AgentModel {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  efforts: { id: string; description?: string }[];
  defaultEffort?: string;
  images: boolean;
}

/** Items of the "/" menu. */
export interface AgentCommand {
  name: string;
  description: string;
  kind: 'command' | 'skill';
}

export interface AgentSession {
  /** Canonical events, in order. Ends when the session closes. */
  readonly events: AsyncIterable<TimelineEvent>;
  /** A new turn. */
  send(input: UserInput): Promise<void>;
  /** Adds to the running turn; starts a turn if none runs. */
  steer(input: UserInput): Promise<void>;
  respond(interactionId: string, answer: InteractionAnswer): Promise<void>;
  setModel(model: string, effort?: string): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  /** Back to before the given user message: conversation (and files, where the agent can). */
  rewind(toItemId: string): Promise<void>;
  /** Compacts the conversation context now. */
  compact(): Promise<void>;
  interrupt(): Promise<void>;
  stopBackground(taskId: string): Promise<void>;
  close(): Promise<void>;
}

export interface AgentStatus {
  installed: boolean;
  version?: string;
  authenticated?: boolean;
  /** Account shown in settings (e-mail or plan), if the agent reports it. */
  account?: string;
}

export interface SandboxCheck {
  /** The sandbox kept a write outside the workspace from happening. */
  holds: boolean;
  /** Setting to start sessions with (`SessionOptions.sandboxMode`). */
  mode?: string;
  detail: string;
}

export interface AgentAdapter {
  readonly id: 'claude-code' | 'codex';
  readonly adapterVersion: string;
  status(): Promise<AgentStatus>;
  /** Opens the agent's own sign-in (browser); resolves when it finishes. */
  login(): Promise<void>;
  listModels(cwd: string): Promise<AgentModel[]>;
  listCommands(cwd: string): Promise<AgentCommand[]>;
  /** D-28: does the sandbox hold the workspace boundary on this machine? */
  checkSandbox(scratchDir: string): Promise<SandboxCheck>;
  start(options: SessionOptions): Promise<AgentSession>;
}

/** Push-based async queue behind `AgentSession.events`. */
export class EventChannel<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private waiting: ((result: IteratorResult<T>) => void) | undefined;
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve({ value, done: false });
    } else {
      this.buffer.push(value);
    }
  }

  close(): void {
    this.closed = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.buffer.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
    };
  }
}
