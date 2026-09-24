import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  query,
  type CanUseTool,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKUserMessage,
  type SpawnOptions,
  type SpawnedProcess,
} from '@anthropic-ai/claude-agent-sdk';
import { ClaudeProjector } from '@skaro/adapter-claude';
import { obj, str, type Interaction } from '@skaro/timeline';
import type { Recorder } from './recorder.ts';
import { lineSplitter, parseJson, ProbeSession, type SessionOptions } from './session.ts';

const MODES: Record<SessionOptions['permission'], PermissionMode> = {
  ask: 'default',
  auto: 'acceptEdits',
  full: 'bypassPermissions',
  plan: 'plan',
};

/** Task tools are off by default on new models; Skaro enables them so the agent plan exists. */
const PLAN_TOOLS = ['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'];

class InputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly items: SDKUserMessage[] = [];
  private wake: (() => void) | undefined;
  private ended = false;

  push(message: SDKUserMessage): void {
    this.items.push(message);
    this.wake?.();
  }

  end(): void {
    this.ended = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      const next = this.items.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = undefined;
    }
  }
}

export class ClaudeSession extends ProbeSession {
  private readonly projector: ClaudeProjector;
  private q: Query | undefined;
  private input = new InputQueue();
  private sessionId = '';
  private lastAssistant = '';
  /** uuids of messages Skaro sent, in order. */
  private readonly sent: string[] = [];
  /** Last assistant uuid of each completed turn. */
  private readonly turnEnds: string[] = [];
  /** Interactions opened from control requests, waiting for canUseTool. */
  private readonly pending: Interaction[] = [];
  private readonly configDir: string | undefined;

  constructor(rec: Recorder, options: SessionOptions) {
    super(rec, options);
    this.projector = new ClaudeProjector(rec.ctx, (event) => {
      if (event.t === 'interaction.opened') this.pending.push(event.interaction);
      this.publish(event);
    });
    this.configDir = options.authMissing
      ? mkdtempSync(join(tmpdir(), 'skaro-probe-noauth-'))
      : undefined;
  }

  async start(resume?: { sessionId: string; at: string }): Promise<void> {
    this.input = new InputQueue();
    const options: Options = {
      cwd: this.options.workspace,
      permissionMode: MODES[this.options.permission],
      allowDangerouslySkipPermissions: this.options.permission === 'full',
      includePartialMessages: true,
      enableFileCheckpointing: true,
      allowedTools: PLAN_TOOLS,
      canUseTool: this.canUseTool,
      spawnClaudeCodeProcess: (spawnOptions) => this.spawnTapped(spawnOptions),
      env: { ...process.env, ...(this.configDir ? { CLAUDE_CONFIG_DIR: this.configDir } : {}) },
    };
    if (this.options.model) options.model = this.options.model;
    if (this.options.effort) options.effort = this.options.effort as Options['effort'];
    if (this.options.sandbox) options.sandbox = { enabled: true, autoAllowBashIfSandboxed: true };
    if (resume) {
      options.resume = resume.sessionId;
      options.resumeSessionAt = resume.at;
    }
    this.rec.raw('meta', {
      event: 'start',
      options: {
        ...options,
        env: undefined,
        canUseTool: undefined,
        spawnClaudeCodeProcess: undefined,
      },
    });
    this.q = query({ prompt: this.input, options });
    void this.drain(this.q);
  }

  async send(text: string, images: string[] = []): Promise<void> {
    const uuid = randomUUID();
    this.sent.push(uuid);
    const content = [
      { type: 'text' as const, text },
      ...images.map((path) => ({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: extname(path) === '.png' ? ('image/png' as const) : ('image/jpeg' as const),
          data: readFileSync(resolve(this.options.workspace, path)).toString('base64'),
        },
      })),
    ];
    this.input.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      uuid,
    } as SDKUserMessage);
  }

  async interrupt(): Promise<void> {
    await this.q?.interrupt();
  }

  async compact(): Promise<void> {
    await this.turn('/compact');
  }

  async rewind(beforeMessage: number): Promise<void> {
    const userMessage = this.sent[beforeMessage - 1];
    const at = this.turnEnds[beforeMessage - 2];
    if (!this.q || !userMessage || !at) throw new Error('nothing to rewind to');
    // Files: restore checkpoints. Conversation: restart the CLI resumed at the previous turn's end.
    const result = await this.q.rewindFiles(userMessage);
    this.rec.raw('meta', { event: 'rewindFiles', result });
    await this.close();
    await this.start({ sessionId: this.sessionId, at });
  }

  async close(): Promise<void> {
    this.input.end();
    this.q?.close();
  }

  private async drain(q: Query): Promise<void> {
    try {
      for await (const _ of q) {
        // Messages are consumed from the raw tap; the SDK iterator only needs draining.
      }
    } catch (error) {
      this.rec.raw('meta', { event: 'query-error', error: String(error) });
    }
  }

  private readonly canUseTool: CanUseTool = async (toolName, input, { suggestions, toolUseID }) => {
    const interaction = this.pending.shift();
    if (!interaction) return { behavior: 'allow', updatedInput: input, toolUseID };
    const answer = this.responder(interaction);
    let result: PermissionResult;
    if (answer.kind === 'question') {
      const questions = interaction.kind === 'question' ? interaction.questions : [];
      const answers = Object.fromEntries(
        questions.map((q) => [q.text, (answer.answers[q.id] ?? []).join(', ')]),
      );
      result = { behavior: 'allow', updatedInput: { ...input, answers }, toolUseID };
    } else if (answer.kind === 'plan_approval') {
      result = answer.approve
        ? { behavior: 'allow', updatedInput: input, toolUseID }
        : { behavior: 'deny', message: answer.message ?? 'Plan rejected', toolUseID };
    } else if (answer.choice === 'deny') {
      result = { behavior: 'deny', message: answer.message ?? 'Denied by user', toolUseID };
    } else {
      result = {
        behavior: 'allow',
        updatedInput: input,
        toolUseID,
        ...(answer.choice === 'allow_session' && suggestions
          ? { updatedPermissions: suggestions }
          : {}),
      };
    }
    void toolName;
    return result;
  };

  /** Spawns the CLI like the SDK would, recording every stdin/stdout line. */
  private spawnTapped(options: SpawnOptions): SpawnedProcess {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdin = new PassThrough();
    stdin.on(
      'data',
      lineSplitter((line) => this.projector.input(this.rec.raw('in', parseJson(line)))),
    );
    stdin.pipe(child.stdin);

    const stdout = new PassThrough();
    const onOut = lineSplitter((line) => {
      const msg = this.rec.raw('out', parseJson(line));
      this.track(msg);
      this.projector.output(msg);
      stdout.write(line + '\n');
    });
    child.stdout.on('data', onOut);
    child.stdout.on('end', () => stdout.end());
    child.stderr.on(
      'data',
      lineSplitter((line) => this.rec.raw('err', line)),
    );

    return {
      stdin,
      stdout,
      get killed() {
        return child.killed;
      },
      get exitCode() {
        return child.exitCode;
      },
      get signalCode() {
        return child.signalCode;
      },
      kill: (signal: NodeJS.Signals) => child.kill(signal),
      on: (event: string, listener: (...args: unknown[]) => void) => void child.on(event, listener),
      once: (event: string, listener: (...args: unknown[]) => void) =>
        void child.once(event, listener),
      off: (event: string, listener: (...args: unknown[]) => void) =>
        void child.off(event, listener),
    } as unknown as SpawnedProcess;
  }

  private track(line: unknown): void {
    const msg = obj(line);
    if (!msg) return;
    if (msg['type'] === 'system' && msg['subtype'] === 'init')
      this.sessionId = str(msg['session_id']) ?? this.sessionId;
    if (msg['type'] === 'assistant' && !msg['parent_tool_use_id'])
      this.lastAssistant = str(msg['uuid']) ?? this.lastAssistant;
    if (msg['type'] === 'result') this.turnEnds.push(this.lastAssistant);
  }
}
