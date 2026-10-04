// Codex session over `codex app-server` with the pinned binary (D-23) and the
// experimental API (D-29). Every JSON-RPC line is recorded raw and projected (P2).

import {
  EventChannel,
  asyncQuestionInput,
  isAsyncQuestion,
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
import { CodexProjector } from './projector.ts';
import { AppServer, type CodexBinary } from './rpc.ts';
import { codexMcpConfig } from './mcp-config.ts';
import { codexPolicy, sandboxPolicy } from './session-policy.ts';
import { TurnControl } from './turn-control.ts';
import { PERMISSION_CONTINUATION, toInput, toCodexAnswer } from './session-input.ts';
import { CODEX_DEFAULT_INSTRUCTIONS } from './interaction-instructions.ts';

export { codexPolicy } from './session-policy.ts';

export interface CodexSessionConfig extends CodexBinary {
  /** `-c key=value` overrides, e.g. the Windows sandbox mode chosen by the self-check. */
  config?: string[];
  codexHome?: string;
}

export class CodexSession implements AgentSession {
  readonly events: EventChannel<TimelineEvent> = new EventChannel();
  private readonly projector: CodexProjector;
  private readonly options: SessionOptions;
  private readonly config: CodexSessionConfig;
  private server: AppServer | undefined;
  private threadId = '';
  private model = '';
  private effort: string | undefined;
  private mode: PermissionMode;
  private planning: boolean;
  private readonly turns = new TurnControl();
  private readonly interactions = new Map<string, Interaction>();
  private readonly requestIds = new Map<string, unknown>();
  private closed = false;

  constructor(options: SessionOptions, config: CodexSessionConfig) {
    this.options = options;
    this.config = config;
    this.mode = options.permissionMode;
    this.planning = options.planFirst ?? false;
    this.effort = options.effort;
    this.projector = new CodexProjector(options.context, (event) => {
      if (event.t === 'interaction.opened')
        this.interactions.set(event.interaction.id, event.interaction);
      if (event.t === 'interaction.closed') this.interactions.delete(event.id);
      if (event.t === 'turn.completed') {
        for (const [id, interaction] of this.interactions)
          if (!isAsyncQuestion(interaction)) this.interactions.delete(id);
        this.requestIds.clear();
      }
      this.events.push(this.turns.observe(event));
    });
  }

  async start(): Promise<void> {
    const o = this.options;
    const now = () => o.context.now();
    this.server = await AppServer.start({
      ...this.config,
      config: [
        ...(this.config.config ?? []),
        ...(o.sandboxMode ? [`windows.sandbox="${o.sandboxMode}"`] : []),
        'features.default_mode_request_user_input=true',
        'suppress_unstable_features_warning=true',
      ],
      cwd: o.cwd,
      ...(o.env ? { env: o.env } : {}),
      onMessage: (msg) => {
        // Server requests are answered by their own id (numbers or strings).
        if (typeof msg['method'] === 'string' && msg['id'] !== undefined) {
          this.requestIds.set(`req-${String(msg['id'])}`, msg['id']);
        }
      },
      onRaw: (dir, line) => {
        o.raw({ ts: now(), dir, line });
        if (dir === 'in') this.projector.input(line);
        else if (dir === 'out') this.projector.output(line);
      },
      onExit: (code, signal) => {
        o.raw({ ts: now(), dir: 'meta', line: { event: 'exit', code, signal } });
        if (this.turns.active) {
          this.events.push(
            this.turns.observe({
              t: 'turn.completed',
              turnId: this.turns.active,
              outcome: 'failed',
              error: { category: 'other', message: `Codex stopped (${code ?? signal})` },
            }),
          );
        }
        void this.close();
      },
    });
    const policy = codexPolicy(this.mode, o);
    const mcp = codexMcpConfig(o.mcpServers);
    const params = {
      cwd: o.cwd,
      approvalPolicy: policy.approvalPolicy,
      sandbox: policy.sandbox,
      ...(o.model ? { model: o.model } : {}),
      ...(o.instructions ? { developerInstructions: o.instructions } : {}),
      ...(Object.keys(mcp).length ? { config: mcp } : {}),
    };
    const result = obj(
      o.resume
        ? await this.server.request('thread/resume', {
            threadId: o.resume,
            ...params,
            excludeTurns: true,
          })
        : await this.server.request('thread/start', params),
    );
    this.threadId = str(obj(result?.['thread'])?.['id']) ?? '';
    this.model = str(result?.['model']) ?? o.model ?? '';
  }

  send(input: UserInput): Promise<void> {
    return this.turns.run(() => this.startTurn(input));
  }

  private async startTurn(input: UserInput): Promise<void> {
    if (this.closed) throw new Error('Codex session is closed');
    const policy = codexPolicy(this.mode, this.options);
    await this.rpc().request('turn/start', {
      threadId: this.threadId,
      input: toInput(input),
      ...(this.model ? { model: this.model } : {}),
      ...(this.effort ? { effort: this.effort } : {}),
      approvalPolicy: policy.approvalPolicy,
      sandboxPolicy: sandboxPolicy(policy.sandbox),
      collaborationMode: {
        mode: this.planning ? 'plan' : 'default',
        settings: {
          model: this.model,
          reasoning_effort: this.effort ?? null,
          developer_instructions: this.planning ? null : CODEX_DEFAULT_INSTRUCTIONS,
        },
      },
    });
  }

  /** Adds to the running turn; without one, `turn/steer` fails, so it becomes a new turn. */
  steer(input: UserInput): Promise<void> {
    return this.turns.run(async () => {
      if (!this.turns.active) return this.startTurn(input);
      await this.rpc().request('turn/steer', {
        threadId: this.threadId,
        input: toInput(input),
        expectedTurnId: this.turns.active,
      });
    });
  }

  async respond(interactionId: string, answer: InteractionAnswer): Promise<void> {
    const interaction = this.interactions.get(interactionId);
    if (!interaction) throw new Error(`no open interaction ${interactionId}`);
    if (isAsyncQuestion(interaction)) return this.steer(asyncQuestionInput(interaction, answer));
    if (interaction.kind === 'plan_approval' && answer.kind === 'plan_approval') {
      // Codex has no approval request: the answer is the next turn, out of plan mode if approved.
      this.planning = !answer.approve;
      await this.send({
        text: answer.approve
          ? 'The plan is approved. Implement it.'
          : (answer.message ?? 'Revise the plan.'),
      });
      return;
    }
    if (!this.requestIds.has(interactionId))
      throw new Error(`no server request for ${interactionId}`);
    this.rpc().reply(this.requestIds.get(interactionId), toCodexAnswer(interaction, answer));
    this.requestIds.delete(interactionId);
  }

  async setModel(model: string, effort?: string): Promise<void> {
    this.model = model;
    this.effort = effort;
  }

  /** Restart the active turn with new permissions, retaining its thread and conversation. */
  setPermissionMode(mode: PermissionMode): Promise<void> {
    return this.turns.run(async () => {
      if (mode === this.mode) return;
      const before = this.mode;
      this.mode = mode;
      try {
        await this.turns.resumeWithPermissions(
          (turnId) => this.rpc().request('turn/interrupt', { threadId: this.threadId, turnId }),
          () => this.startTurn({ text: PERMISSION_CONTINUATION }),
          (event) => {
            this.options.raw({
              ts: this.options.context.now(),
              dir: 'meta',
              line: { skaro: 'event', event },
            });
            this.events.push(event);
          },
        );
      } catch (error) {
        this.mode = before;
        throw error;
      }
    });
  }

  /** Conversation only: `thread/revert` keeps files, Skaro restores them from git (agent-output.md 9.2). */
  async rewind(toItemId: string): Promise<void> {
    const turnId = this.projector.turnOf(toItemId);
    if (!turnId) throw new Error(`unknown message ${toItemId}`);
    await this.rpc().request('thread/revert', { threadId: this.threadId, beforeTurnId: turnId });
  }

  async compact(): Promise<void> {
    await this.rpc().request('thread/compact/start', { threadId: this.threadId });
  }

  async interrupt(): Promise<void> {
    this.turns.cancelRestart();
    const active = this.turns.active;
    if (active)
      await this.rpc().request('turn/interrupt', {
        threadId: this.threadId,
        turnId: active,
      });
    // A continuation may already be starting: stop it once its turn/start finishes too.
    await this.turns.run(async () => {
      if (this.turns.active && this.turns.active !== active)
        await this.rpc().request('turn/interrupt', {
          threadId: this.threadId,
          turnId: this.turns.active,
        });
    });
  }

  async stopBackground(): Promise<void> {
    // Codex background terminals end with the turn; there is nothing to stop separately.
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.turns.cancelRestart();
    await this.server?.close();
    this.events.close();
  }

  private rpc(): AppServer {
    if (!this.server) throw new Error('session not started');
    return this.server;
  }
}
