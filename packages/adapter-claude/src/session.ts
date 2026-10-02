// Claude Code session over the pinned Agent SDK; raw process IO remains the source of truth.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  query,
  type CanUseTool,
  type OnElicitation,
  type PermissionResult,
  type Query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
  EventChannel,
  obj,
  str,
  type AgentSession,
  type Interaction,
  type InteractionAnswer,
  type PermissionMode,
  type SessionOptions,
  type TimelineEvent,
  type UserInput,
} from '@skaro/timeline';
import { ClaudeProjector } from './projector.ts';
import { type ClaudeSessionConfig, nativeMode, EDIT_TOOLS, SHELL_TOOLS } from './session-config.ts';
import { InputQueue } from './session-queue.ts';
import { imageType } from './session-helpers.ts';
import { queryOptions } from './session-options.ts';
import { spawnTapped } from './session-tap.ts';
export { nativeMode } from './session-config.ts';
export type { ClaudeSessionConfig } from './session-config.ts';
export { lines } from './session-helpers.ts';

interface Pending {
  interaction: Interaction;
  resolve: (answer: InteractionAnswer) => void;
}

export class ClaudeSession implements AgentSession {
  readonly events: EventChannel<TimelineEvent> = new EventChannel();
  private readonly projector: ClaudeProjector;
  private readonly options: SessionOptions;
  private readonly config: ClaudeSessionConfig;
  private q: Query | undefined;
  private input = new InputQueue();
  private sessionId = '';
  private lastAssistant = '';
  /** User message uuid → last main-thread assistant uuid before it (resume point for rewind). */
  private readonly resumePoints = new Map<string, string>();
  private readonly interactions = new Map<string, Interaction>();
  private readonly pending = new Map<string, Pending>();
  /** Answers that arrived before canUseTool asked for them. */
  private readonly early = new Map<string, InteractionAnswer>();
  private mode: PermissionMode;
  private planFirst: boolean;
  private closed = false;

  constructor(options: SessionOptions, config: ClaudeSessionConfig) {
    this.options = options;
    this.config = config;
    this.mode = options.permissionMode;
    this.planFirst = options.planFirst ?? false;
    this.projector = new ClaudeProjector(options.context, (event) => {
      if (event.t === 'interaction.opened')
        this.interactions.set(event.interaction.id, event.interaction);
      if (event.t === 'interaction.closed') this.interactions.delete(event.id);
      if (event.t === 'session.started') this.sessionId = event.nativeSessionId || this.sessionId;
      this.events.push(event);
    });
  }

  start(resume?: { sessionId: string; at?: string }): void {
    this.input = new InputQueue();
    const o = this.options;
    const options = queryOptions(o, this.config, this.mode, this.planFirst, {
      canUseTool: this.canUseTool,
      onElicitation: this.onElicitation,
      spawnClaudeCodeProcess: (spawnOptions) =>
        spawnTapped(spawnOptions, this.options, this.projector, (line) => this.track(line)),
    });
    const resumeFrom = resume ?? (o.resume ? { sessionId: o.resume } : undefined);
    if (resumeFrom) {
      options.resume = resumeFrom.sessionId;
      if (resumeFrom.at) options.resumeSessionAt = resumeFrom.at;
    }
    this.q = query({ prompt: this.input, options });
    void this.drain(this.q);
  }

  async send(input: UserInput): Promise<void> {
    const uuid = randomUUID();
    if (this.lastAssistant) this.resumePoints.set(uuid, this.lastAssistant);
    else this.resumePoints.set(uuid, '');
    const content = [
      { type: 'text' as const, text: input.text },
      ...(input.images ?? []).map((path) => ({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: imageType(path),
          data: readFileSync(path).toString('base64'),
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

  /** Claude picks up messages between steps, so steering is just another message. */
  steer(input: UserInput): Promise<void> {
    return this.send(input);
  }

  async respond(interactionId: string, answer: InteractionAnswer): Promise<void> {
    const pending = this.pending.get(interactionId);
    if (pending) {
      this.pending.delete(interactionId);
      pending.resolve(answer);
      return;
    }
    // The user may answer before the SDK calls canUseTool for the request.
    if (!this.interactions.has(interactionId))
      throw new Error(`no open interaction ${interactionId}`);
    this.early.set(interactionId, answer);
  }

  async setModel(model: string, effort?: string): Promise<void> {
    await this.q?.setModel(model);
    if (effort) await this.q?.applyFlagSettings({ effortLevel: effort as never });
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.mode = mode;
    if (!this.planFirst) await this.q?.setPermissionMode(nativeMode(mode));
  }

  /** Files back to before the message (checkpoints), then the CLI resumes at the turn before it. */
  async rewind(toItemId: string): Promise<void> {
    if (!this.q) throw new Error('session not started');
    const at = this.resumePoints.get(toItemId);
    if (at === undefined) throw new Error(`unknown message ${toItemId}`);
    await this.q.rewindFiles(toItemId);
    this.stopQuery();
    this.lastAssistant = at;
    this.start(at ? { sessionId: this.sessionId, at } : undefined);
  }

  /** Claude compacts on the /compact command. */
  compact(): Promise<void> {
    return this.send({ text: '/compact' });
  }

  async interrupt(): Promise<void> {
    await this.q?.interrupt();
  }

  async stopBackground(taskId: string): Promise<void> {
    await this.q?.stopTask(taskId);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopQuery();
    for (const pending of this.pending.values())
      pending.resolve({ kind: 'approval', choice: 'deny', message: 'Session closed' });
    this.events.close();
  }

  private stopQuery(): void {
    this.input.end();
    this.q?.close();
    this.q = undefined;
  }

  private async drain(q: Query): Promise<void> {
    try {
      for await (const _message of q) {
        // Messages are consumed from the raw tap; the iterator only needs draining.
      }
    } catch (error) {
      this.options.raw({
        ts: this.options.context.now(),
        dir: 'meta',
        line: { event: 'query-error', error: String(error) },
      });
    }
  }

  /** Waits for the user's answer to the interaction the projector opened for this call. */
  private waitForAnswer(interactionId: string): Promise<InteractionAnswer> {
    const interaction = this.interactions.get(interactionId);
    if (!interaction) return Promise.resolve({ kind: 'approval', choice: 'allow_once' });
    const early = this.early.get(interactionId);
    if (early) {
      this.early.delete(interactionId);
      return Promise.resolve(early);
    }
    return new Promise((resolve) => {
      this.pending.set(interactionId, { interaction, resolve });
    });
  }

  private readonly canUseTool: CanUseTool = async (toolName, input, { suggestions, toolUseID }) => {
    // The projector saw the control_request first and opened the interaction.
    const interactionId = this.projector.interactionForToolUse(toolUseID);
    if (!interactionId) return { behavior: 'allow', updatedInput: input, toolUseID };
    // A command that needs permission is not read-only (agent-output.md 5.4).
    if (this.options.readOnly && [...EDIT_TOOLS, ...SHELL_TOOLS].includes(toolName)) {
      return {
        behavior: 'deny',
        message: 'This chat is read-only: only read-only commands can run here.',
        toolUseID,
      };
    }
    const answer = await this.waitForAnswer(interactionId);
    const interaction = this.interactions.get(interactionId);
    let result: PermissionResult;
    if (answer.kind === 'question') {
      const questions = interaction?.kind === 'question' ? interaction.questions : [];
      const answers = Object.fromEntries(
        questions.map((q) => [q.text, (answer.answers[q.id] ?? []).join(', ')]),
      );
      result = { behavior: 'allow', updatedInput: { ...input, answers }, toolUseID };
    } else if (answer.kind === 'plan_approval') {
      if (answer.approve) {
        // Leaving plan mode: continue in the chosen permission mode.
        this.planFirst = false;
        result = { behavior: 'allow', updatedInput: input, toolUseID };
        queueMicrotask(() => void this.q?.setPermissionMode(nativeMode(this.mode)));
      } else {
        result = { behavior: 'deny', message: answer.message ?? 'Plan rejected', toolUseID };
      }
    } else if (answer.kind === 'approval' && answer.choice !== 'deny') {
      result = {
        behavior: 'allow',
        updatedInput: input,
        toolUseID,
        ...(answer.choice === 'allow_session' && suggestions
          ? { updatedPermissions: suggestions }
          : {}),
      };
    } else {
      const message =
        answer.kind === 'approval' && answer.choice === 'deny' ? answer.message : undefined;
      result = { behavior: 'deny', message: message ?? 'Denied by user', toolUseID };
    }
    return result;
  };

  private readonly onElicitation: OnElicitation = async (_request, { requestId }) => {
    const answer = await this.waitForAnswer(`elicit-${requestId}`);
    if (answer.kind === 'form' && answer.action === 'accept')
      return { action: 'accept', content: answer.values ?? {} };
    if (answer.kind === 'login' && answer.action === 'done') return { action: 'accept' };
    return { action: 'decline' };
  };

  private track(line: unknown): void {
    const msg = obj(line);
    if (msg?.['type'] === 'assistant' && !msg['parent_tool_use_id']) {
      this.lastAssistant = str(msg['uuid']) ?? this.lastAssistant;
    }
  }
}
