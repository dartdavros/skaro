// Codex session over `codex app-server` with the pinned binary (D-23) and the
// experimental API (D-29). Every JSON-RPC line is recorded raw and projected (P2).

import {
  EventChannel,
  asyncQuestionInput,
  isAsyncQuestion,
  obj,
  operationTimeout,
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
import { codexPolicy, sandboxPolicy } from './session-policy.ts';
import { CodexSessionProcess, type CodexSessionConfig } from './session-process.ts';
import { RpcError } from './rpc.ts';
import { TurnControl } from './turn-control.ts';
import { PERMISSION_CONTINUATION, toInput, toCodexAnswer } from './session-input.ts';
import { CODEX_DEFAULT_INSTRUCTIONS } from './interaction-instructions.ts';

export { codexPolicy } from './session-policy.ts';
export type { CodexSessionConfig } from './session-process.ts';

export class CodexSession implements AgentSession {
  readonly events: EventChannel<TimelineEvent> = new EventChannel();
  private readonly projector: CodexProjector;
  private readonly options: SessionOptions;
  private readonly process: CodexSessionProcess;
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
    this.mode = options.permissionMode;
    this.planning = options.planFirst ?? false;
    this.effort = options.effort;
    this.process = new CodexSessionProcess(options, config, {
      onMessage: (msg) => {
        if (typeof msg['method'] === 'string' && msg['id'] !== undefined)
          this.requestIds.set(`req-${String(msg['id'])}`, msg['id']);
      },
      onRaw: (dir, line) => {
        if (dir === 'in') this.projector.input(line);
        else if (dir === 'out') this.projector.output(line);
      },
      onExit: (code, signal) => {
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
    this.projector = new CodexProjector(options.context, (event) => {
      if (event.t === 'interaction.opened')
        this.interactions.set(event.interaction.id, event.interaction);
      if (event.t === 'interaction.closed') this.interactions.delete(event.id);
      if (event.t === 'turn.completed') {
        this.process.failed(event.error);
        for (const [id, interaction] of this.interactions)
          if (!isAsyncQuestion(interaction)) this.interactions.delete(id);
        this.requestIds.clear();
      }
      this.events.push(this.turns.observe(event));
      // Async deliveries do not suspend native execution. Stop this turn at the question;
      // the owner answer explicitly starts/steers the same thread later.
      if (event.t === 'interaction.opened' && isAsyncQuestion(event.interaction))
        void this.interrupt().catch(() => this.close());
    });
  }

  start(): Promise<void> {
    return this.ensureReady();
  }

  private async ensureReady(): Promise<void> {
    if (this.closed) throw new Error('Codex session is closed');
    // Login and auth failures never interrupt an active turn or its pending approvals.
    if (this.turns.active) return;
    const model = this.model;
    const result = await this.process.ensure(
      this.threadId || this.options.resume,
      model || this.options.model,
      this.mode,
    );
    if (result) {
      this.threadId = result.threadId;
      if (this.model === model) this.model = result.model;
    }
  }

  send(input: UserInput): Promise<void> {
    return this.turns.run(() => this.startTurn(input));
  }

  private async startTurn(input: UserInput): Promise<void> {
    await this.ensureReady();
    const policy = codexPolicy(this.mode, this.options);
    const result = obj(
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
      }),
    );
    this.turns.accepted(str(obj(result?.['turn'])?.['id']));
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
          (turnId) => this.interruptTurn(turnId),
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
    await this.turns.run(async () => {
      await this.ensureReady();
      await this.rpc().request('thread/revert', { threadId: this.threadId, beforeTurnId: turnId });
    });
  }

  async compact(): Promise<void> {
    await this.turns.run(async () => {
      await this.ensureReady();
      await this.rpc().request('thread/compact/start', { threadId: this.threadId });
    });
  }

  async interrupt(): Promise<void> {
    this.turns.cancelRestart();
    const active = this.turns.active;
    if (active) await this.interruptTurn(active);
    // A continuation may already be starting: stop it once its turn/start finishes too.
    await this.turns.run(async () => {
      const next = this.turns.active;
      if (next && next !== active) await this.interruptTurn(next);
    });
  }

  private async interruptTurn(id: string): Promise<void> {
    if (!(await this.turns.whenStarted(id)) || this.turns.active !== id) return;
    try {
      const completed = this.turns.whenCompleted(id);
      await operationTimeout(
        Promise.all([
          this.rpc()
            .request('turn/interrupt', { threadId: this.threadId, turnId: id })
            .catch((error: unknown) => {
              if (!(
                error instanceof RpcError &&
                error.code === -32600 &&
                error.message === 'turn/interrupt: no active turn to interrupt'
              ))
                throw error;
            }),
          completed,
        ]),
        15_000,
        'Codex did not confirm interruption',
      );
    } catch (error) {
      // Confirm the terminal event even when the native RPC reply precedes its notification.
      if (!(
        error instanceof RpcError &&
        error.code === -32600 &&
        error.message === 'turn/interrupt: no active turn to interrupt'
      ))
        throw error;
      await this.turns.whenCompleted(id).catch(() => {
        throw error;
      });
    }
  }

  async stopBackground(): Promise<void> {
    // Codex background terminals end with the turn; there is nothing to stop separately.
  }

  async close(): Promise<void> {
    if (this.closed) {
      await this.process.close();
      this.events.close();
      return;
    }
    this.closed = true;
    this.turns.cancelRestart();
    await this.process.close();
    this.events.close();
  }

  private rpc(): CodexSessionProcess {
    return this.process;
  }
}
