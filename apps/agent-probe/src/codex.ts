import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { CodexProjector } from '@skaro/adapter-codex';
import { obj, str, type Interaction, type InteractionAnswer } from '@skaro/timeline';
import type { Recorder } from './recorder.ts';
import { lineSplitter, parseJson, ProbeSession, type SessionOptions } from './session.ts';

const TRIPLES: Record<string, string> = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
};

/** Pinned Codex binary from the @openai/codex platform package, as its launcher finds it. */
export function codexBinary(): { exe: string; pathDir: string } {
  const key = `${process.platform}-${process.arch}`;
  const triple = TRIPLES[key];
  if (!triple) throw new Error(`unsupported platform ${key}`);
  const require = createRequire(import.meta.url);
  const launcher = require.resolve('@openai/codex/package.json');
  const platformPkg = createRequire(launcher).resolve(`@openai/codex-${key}/package.json`);
  const vendor = join(dirname(platformPkg), 'vendor', triple);
  return {
    exe: join(vendor, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex'),
    pathDir: join(vendor, 'codex-path'),
  };
}

const POLICIES: Record<SessionOptions['permission'], { approvalPolicy: string; sandbox: string }> =
  {
    ask: { approvalPolicy: 'untrusted', sandbox: 'workspace-write' },
    auto: { approvalPolicy: 'on-request', sandbox: 'workspace-write' },
    full: { approvalPolicy: 'never', sandbox: 'danger-full-access' },
    plan: { approvalPolicy: 'on-request', sandbox: 'read-only' },
  };

/** Notifications Skaro does not need (docs/agent-output.md, 1.2). */
const OPT_OUT = [
  'thread/realtime/started',
  'thread/realtime/itemAdded',
  'thread/realtime/item/started',
  'thread/realtime/item/transcript/delta',
  'thread/realtime/item/completed',
  'thread/realtime/transcript/delta',
  'thread/realtime/transcript/done',
  'thread/realtime/outputAudio/delta',
  'thread/realtime/sdp',
  'thread/realtime/error',
  'thread/realtime/closed',
  'fuzzyFileSearch/sessionUpdated',
  'fuzzyFileSearch/sessionCompleted',
  'rawResponseItem/completed',
  'rawResponse/completed',
];

export class CodexSession extends ProbeSession {
  private readonly projector: CodexProjector;
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private readonly waiting = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private threadId = '';
  private model = '';
  private planApproved = false;
  private currentTurn = '';
  private readonly turnIds: string[] = [];
  private readonly interactions = new Map<string, Interaction>();

  constructor(rec: Recorder, options: SessionOptions) {
    super(rec, options);
    this.projector = new CodexProjector(rec.ctx, (event) => {
      if (event.t === 'interaction.opened')
        this.interactions.set(event.interaction.id, event.interaction);
      if (event.t === 'turn.started') {
        this.currentTurn = event.turnId;
        this.turnIds.push(event.turnId);
      }
      this.publish(event);
    });
  }

  async start(): Promise<void> {
    const { exe, pathDir } = codexBinary();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${pathDir}${delimiter}${process.env['PATH'] ?? ''}`,
    };
    if (this.options.authMissing)
      env['CODEX_HOME'] = mkdtempSync(join(tmpdir(), 'skaro-probe-noauth-'));
    this.rec.raw('meta', {
      event: 'start',
      binary: 'codex app-server',
      args: this.options.codexConfig,
      options: { ...this.options, workspace: undefined },
    });
    const args = ['app-server', ...(this.options.codexConfig ?? []).flatMap((kv) => ['-c', kv])];
    const child = spawn(exe, args, { cwd: this.options.workspace, env, windowsHide: true });
    this.child = child;
    child.stdout.on(
      'data',
      lineSplitter((line) => this.onLine(line)),
    );
    child.stderr.on(
      'data',
      lineSplitter((line) => this.rec.raw('err', line)),
    );
    child.on('exit', (code, signal) => {
      this.rec.raw('meta', { event: 'exit', code, signal });
      for (const w of this.waiting.values())
        w.reject(new Error(`codex exited (${code ?? signal})`));
    });

    await this.request('initialize', {
      clientInfo: { name: 'skaro_probe', title: 'Skaro', version: '0.0.0' },
      capabilities: {
        experimentalApi: this.options.experimental ?? false,
        requestAttestation: false,
        optOutNotificationMethods: OPT_OUT,
      },
    });
    this.notify('initialized');
    const policy = POLICIES[this.options.permission];
    const thread = obj(
      await this.request('thread/start', {
        cwd: this.options.workspace,
        approvalPolicy: policy.approvalPolicy,
        sandbox: policy.sandbox,
        ...(this.options.model ? { model: this.options.model } : {}),
      }),
    );
    this.threadId = str(obj(thread?.['thread'])?.['id']) ?? '';
    this.model = str(thread?.['model']) ?? '';
  }

  async send(text: string, images: string[] = []): Promise<void> {
    const input = [
      { type: 'text', text, text_elements: [] },
      ...images.map((path) => ({
        type: 'localImage',
        path: resolve(this.options.workspace, path),
      })),
    ];
    const planning = this.options.permission === 'plan' && !this.planApproved;
    await this.request('turn/start', {
      threadId: this.threadId,
      input,
      ...(this.options.effort ? { effort: this.options.effort } : {}),
      ...(this.options.experimental
        ? {
            collaborationMode: {
              mode: planning ? 'plan' : 'default',
              settings: { model: this.model, reasoning_effort: null, developer_instructions: null },
            },
          }
        : {}),
      // After the plan is approved the thread leaves read-only mode for implementation.
      ...(this.planApproved
        ? {
            approvalPolicy: POLICIES.auto.approvalPolicy,
            sandboxPolicy: {
              type: 'workspaceWrite',
              writableRoots: [],
              networkAccess: false,
              excludeTmpdirEnvVar: false,
              excludeSlashTmp: false,
            },
          }
        : {}),
    });
  }

  /** Codex has no plan approval request: approval is the next turn, out of plan mode. */
  override async approvePlan(): Promise<void> {
    this.planApproved = true;
    await this.turn('The plan is approved. Implement it.');
  }

  async interrupt(): Promise<void> {
    await this.request('turn/interrupt', { threadId: this.threadId, turnId: this.currentTurn });
  }

  async compact(): Promise<void> {
    const done = this.waitFor((e) => e.t === 'turn.completed', 5 * 60_000);
    await this.request('thread/compact/start', { threadId: this.threadId });
    await done;
  }

  async rewind(beforeMessage: number): Promise<void> {
    const turnId = this.turnIds[beforeMessage - 1];
    if (!turnId) throw new Error('nothing to rewind to');
    await this.request('thread/revert', { threadId: this.threadId, beforeTurnId: turnId });
  }

  async close(): Promise<void> {
    this.child?.stdin.end();
    this.child?.kill();
  }

  private onLine(line: string): void {
    const msg = obj(this.rec.raw('out', parseJson(line)));
    if (!msg) return;
    this.projector.output(msg);
    const id = msg['id'];
    if (typeof msg['method'] === 'string' && id !== undefined) {
      this.answerServerRequest(id, msg['method']);
    } else if (typeof id === 'number' && this.waiting.has(id)) {
      const w = this.waiting.get(id);
      this.waiting.delete(id);
      const error = obj(msg['error']);
      if (error) w?.reject(new Error(`${str(error['message'])}`));
      else w?.resolve(msg['result']);
    }
  }

  private answerServerRequest(id: unknown, method: string): void {
    const interaction = this.interactions.get(`req-${String(id)}`);
    if (!interaction) {
      // Unknown request (e.g. MCP elicitation): decline so the agent does not hang.
      this.write({
        id,
        result: method === 'mcpServer/elicitation/request' ? { action: 'decline' } : {},
      });
      return;
    }
    this.write({ id, result: toCodexAnswer(interaction, this.responder(interaction)) });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) =>
      this.waiting.set(id, { resolve, reject }),
    );
    this.write({ id, method, params });
    return promise;
  }

  private notify(method: string, params?: unknown): void {
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  private write(msg: object): void {
    this.projector.input(this.rec.raw('in', msg));
    this.child?.stdin.write(JSON.stringify(msg) + '\n');
  }
}

function toCodexAnswer(interaction: Interaction, answer: InteractionAnswer): unknown {
  if (answer.kind === 'question') {
    return {
      answers: Object.fromEntries(
        Object.entries(answer.answers).map(([id, answers]) => [id, { answers }]),
      ),
    };
  }
  if (answer.kind === 'plan_approval') return { decision: answer.approve ? 'accept' : 'decline' };
  const decision =
    answer.choice === 'allow_once'
      ? 'accept'
      : answer.choice === 'allow_session'
        ? 'acceptForSession'
        : 'decline';
  void interaction;
  return { decision };
}
