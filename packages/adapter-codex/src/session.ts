// Codex session over `codex app-server` with the pinned binary (D-23) and the
// experimental API (D-29). Every JSON-RPC line is recorded raw and projected (P2).

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
import { CodexProjector } from './projector.ts';
import { AppServer, type CodexBinary } from './rpc.ts';

export interface CodexSessionConfig extends CodexBinary {
  /** `-c key=value` overrides, e.g. the Windows sandbox mode chosen by the self-check. */
  config?: string[];
  codexHome?: string;
}

interface Policy {
  approvalPolicy: 'untrusted' | 'on-request' | 'never';
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
}

/** Skaro mode → Codex approval and sandbox (architecture.md 5.4, D-28). */
export function codexPolicy(
  mode: PermissionMode,
  options: { readOnly?: boolean; sandboxVerified?: boolean } = {},
): Policy {
  if (options.readOnly) return { approvalPolicy: 'on-request', sandbox: 'read-only' };
  if (mode === 'full') return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
  if (mode === 'auto' && options.sandboxVerified)
    return { approvalPolicy: 'on-request', sandbox: 'workspace-write' };
  // "Ask", and "auto" where the sandbox does not hold: commands need approval.
  return { approvalPolicy: 'untrusted', sandbox: 'workspace-write' };
}

function sandboxPolicy(sandbox: Policy['sandbox']): Record<string, unknown> {
  if (sandbox === 'danger-full-access') return { type: 'dangerFullAccess' };
  if (sandbox === 'read-only') return { type: 'readOnly', networkAccess: false };
  return {
    type: 'workspaceWrite',
    writableRoots: [],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
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
  private activeTurn: string | undefined;
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
      if (event.t === 'turn.started') this.activeTurn = event.turnId;
      if (event.t === 'turn.completed') this.activeTurn = undefined;
      this.events.push(event);
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
      ],
      cwd: o.cwd,
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
        if (this.activeTurn) {
          this.events.push({
            t: 'turn.completed',
            turnId: this.activeTurn,
            outcome: 'failed',
            error: { category: 'other', message: `Codex stopped (${code ?? signal})` },
          });
        }
        void this.close();
      },
    });
    const policy = codexPolicy(this.mode, o);
    const mcp = Object.fromEntries(
      Object.entries(o.mcpServers ?? {}).map(([name, s]) => [
        `mcp_servers.${name}`,
        { url: s.url, ...(s.headers ? { http_headers: s.headers } : {}) },
      ]),
    );
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
        ? await this.server.request('thread/resume', { threadId: o.resume, ...params })
        : await this.server.request('thread/start', params),
    );
    this.threadId = str(obj(result?.['thread'])?.['id']) ?? '';
    this.model = str(result?.['model']) ?? o.model ?? '';
  }

  async send(input: UserInput): Promise<void> {
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
          developer_instructions: null,
        },
      },
    });
  }

  /** Adds to the running turn; without one, `turn/steer` fails, so it becomes a new turn. */
  async steer(input: UserInput): Promise<void> {
    if (!this.activeTurn) return this.send(input);
    await this.rpc().request('turn/steer', {
      threadId: this.threadId,
      input: toInput(input),
      expectedTurnId: this.activeTurn,
    });
  }

  async respond(interactionId: string, answer: InteractionAnswer): Promise<void> {
    const interaction = this.interactions.get(interactionId);
    if (!interaction) throw new Error(`no open interaction ${interactionId}`);
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

  /** Applies from the next turn: approval policy and sandbox go with every turn/start. */
  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.mode = mode;
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
    if (this.activeTurn)
      await this.rpc().request('turn/interrupt', {
        threadId: this.threadId,
        turnId: this.activeTurn,
      });
  }

  async stopBackground(): Promise<void> {
    // Codex background terminals end with the turn; there is nothing to stop separately.
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.server?.close();
    this.events.close();
  }

  private rpc(): AppServer {
    if (!this.server) throw new Error('session not started');
    return this.server;
  }
}

function toInput(input: UserInput): unknown[] {
  return [
    { type: 'text', text: input.text, text_elements: [] },
    ...(input.images ?? []).map((path) => ({ type: 'localImage', path })),
  ];
}

function toCodexAnswer(interaction: Interaction, answer: InteractionAnswer): unknown {
  switch (answer.kind) {
    case 'question':
      return {
        answers: Object.fromEntries(
          Object.entries(answer.answers).map(([id, answers]) => [id, { answers }]),
        ),
      };
    case 'form':
      return answer.action === 'accept'
        ? { action: 'accept', content: answer.values ?? {}, _meta: null }
        : { action: 'decline', content: null, _meta: null };
    case 'login':
      return { action: answer.action === 'done' ? 'accept' : 'cancel', content: null, _meta: null };
    case 'approval':
      if (interaction.kind !== 'approval') break;
      return {
        decision:
          answer.choice === 'allow_once'
            ? 'accept'
            : answer.choice === 'allow_session'
              ? 'acceptForSession'
              : 'decline',
      };
    default:
      break;
  }
  return { decision: 'decline' };
}
