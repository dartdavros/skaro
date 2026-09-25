// Codex adapter (docs/architecture.md 5.1): status, sign-in, models, skills, sandbox
// self-check and sessions, all through the pinned `codex app-server`.

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  arr,
  obj,
  str,
  type AgentAdapter,
  type AgentCommand,
  type AgentModel,
  type AgentSession,
  type AgentStatus,
  type SandboxCheck,
  type SessionOptions,
} from '@skaro/timeline';
import { CODEX_ADAPTER_VERSION } from './projector.ts';
import { AppServer, type AppServerOptions, type CodexBinary } from './rpc.ts';
import { CodexSession } from './session.ts';

export interface CodexAdapterConfig {
  /** Installed pinned binary, or undefined when not installed yet. */
  binary: () => Promise<CodexBinary | undefined>;
  /** Opens a URL in the system browser (sign-in). */
  openUrl: (url: string) => void;
  codexHome?: string;
  config?: string[];
}

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex' as const;
  readonly adapterVersion = CODEX_ADAPTER_VERSION;
  private readonly config: CodexAdapterConfig;

  constructor(config: CodexAdapterConfig) {
    this.config = config;
  }

  async status(): Promise<AgentStatus> {
    const binary = await this.config.binary();
    if (!binary) return { installed: false };
    return this.withServer(undefined, async (server) => {
      const result = obj(await server.request('account/read', { refreshToken: false }));
      const account = obj(result?.['account']);
      return {
        installed: true,
        authenticated: account !== undefined,
        account: str(account?.['email']) ?? str(account?.['planType']) ?? str(account?.['type']),
      };
    });
  }

  /** ChatGPT sign-in: app-server gives a URL and reports completion itself. */
  async login(): Promise<void> {
    let loginId: string | undefined;
    let done: (error?: Error) => void = () => undefined;
    const finished = new Promise<void>((resolve, reject) => {
      done = (error) => (error ? reject(error) : resolve());
    });
    const server = await AppServer.start(
      await this.serverOptions(undefined, (msg) => {
        if (msg['method'] !== 'account/login/completed') return;
        const p = obj(msg['params']);
        if (loginId && str(p?.['loginId']) && str(p?.['loginId']) !== loginId) return;
        done(
          p?.['success'] === true
            ? undefined
            : new Error(str(p?.['error']) ?? 'Codex sign-in failed'),
        );
      }),
    );
    try {
      const result = obj(await server.request('account/login/start', { type: 'chatgpt' }));
      loginId = str(result?.['loginId']);
      const url = str(result?.['authUrl']);
      if (!url) throw new Error('Codex did not return a sign-in URL');
      this.config.openUrl(url);
      await finished;
    } finally {
      await server.close();
    }
  }

  async listModels(cwd: string): Promise<AgentModel[]> {
    return this.withServer(cwd, async (server) => {
      const result = obj(await server.request('model/list', {}));
      return arr(result?.['data'])
        .map(obj)
        .filter((m): m is Record<string, unknown> => m !== undefined && m['hidden'] !== true)
        .map((m) => ({
          id: str(m['model']) ?? str(m['id']) ?? '',
          name: str(m['displayName']) ?? str(m['model']) ?? '',
          description: str(m['description']) ?? '',
          isDefault: m['isDefault'] === true,
          efforts: arr(m['supportedReasoningEfforts']).map((e) => ({
            id: str(obj(e)?.['reasoningEffort']) ?? '',
            description: str(obj(e)?.['description']),
          })),
          defaultEffort: str(m['defaultReasoningEffort']),
          images: arr(m['inputModalities']).includes('image'),
        }));
    });
  }

  async listCommands(cwd: string): Promise<AgentCommand[]> {
    return this.withServer(cwd, async (server) => {
      const result = obj(await server.request('skills/list', { cwds: [cwd] }));
      return arr(result?.['data'])
        .flatMap((entry) => arr(obj(entry)?.['skills']))
        .map(obj)
        .filter((s): s is Record<string, unknown> => s !== undefined && s['enabled'] !== false)
        .map((s) => ({
          name: str(s['name']) ?? '',
          description: str(s['description']) ?? '',
          kind: 'skill' as const,
        }));
    });
  }

  /**
   * D-28: runs a shell command through `command/exec` in the workspace-write sandbox (no model call)
   * that writes inside the workspace and one level above it. On Windows the elevated sandbox is
   * tried first; if it fails to hold, the unelevated one is returned so commands can still run
   * after the user approves them.
   */
  async checkSandbox(scratchDir: string): Promise<SandboxCheck> {
    const modes = process.platform === 'win32' ? ['elevated', 'unelevated'] : [undefined];
    let fallback: SandboxCheck | undefined;
    for (const mode of modes) {
      const result = await this.probeSandbox(scratchDir, mode);
      if (result.holds) return { holds: true, ...(mode ? { mode } : {}), detail: result.detail };
      if (result.runs)
        fallback ??= { holds: false, ...(mode ? { mode } : {}), detail: result.detail };
    }
    return fallback ?? { holds: false, detail: 'sandboxed commands do not start' };
  }

  async start(options: SessionOptions): Promise<AgentSession> {
    const binary = await this.requireBinary();
    const session = new CodexSession(options, {
      ...binary,
      ...(this.config.config ? { config: this.config.config } : {}),
      ...(this.config.codexHome ? { codexHome: this.config.codexHome } : {}),
    });
    await session.start();
    return session;
  }

  private async probeSandbox(
    scratchDir: string,
    mode: string | undefined,
  ): Promise<{ holds: boolean; runs: boolean; mode?: string; detail: string }> {
    const root = join(scratchDir, `sandbox-${randomUUID()}`);
    const workspace = join(root, 'workspace');
    await mkdir(workspace, { recursive: true });
    const outside = join(root, 'outside.txt');
    const inside = join(workspace, 'inside.txt');
    const shell = (cmd: string) =>
      process.platform === 'win32' ? ['cmd.exe', '/d', '/c', cmd] : ['/bin/sh', '-c', cmd];
    const up = process.platform === 'win32' ? '..\\outside.txt' : '../outside.txt';
    try {
      return await this.withServer(
        workspace,
        async (server) => {
          const exec = (cmd: string) =>
            server
              .request('command/exec', {
                command: shell(cmd),
                cwd: workspace,
                timeoutMs: 20_000,
                sandboxPolicy: {
                  type: 'workspaceWrite',
                  writableRoots: [],
                  networkAccess: false,
                  excludeTmpdirEnvVar: true,
                  excludeSlashTmp: true,
                },
              })
              .catch((error: unknown) => ({ error: String(error) }));
          await exec('echo ok> inside.txt');
          await exec(`echo x> ${up}`);
          const runs = existsSync(inside);
          const escaped = existsSync(outside);
          const label = mode ? `${mode} sandbox` : 'sandbox';
          return {
            holds: runs && !escaped,
            runs,
            ...(mode ? { mode } : {}),
            detail: !runs
              ? `${label}: commands do not start`
              : escaped
                ? `${label}: a command wrote outside the workspace`
                : `${label}: writes stay inside the workspace`,
          };
        },
        mode ? [`windows.sandbox="${mode}"`] : [],
      );
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }

  private async withServer<T>(
    cwd: string | undefined,
    fn: (server: AppServer) => Promise<T>,
    config: string[] = [],
  ): Promise<T> {
    const server = await AppServer.start(await this.serverOptions(cwd, undefined, config));
    try {
      return await fn(server);
    } finally {
      await server.close();
    }
  }

  private async serverOptions(
    cwd: string | undefined,
    onMessage?: AppServerOptions['onMessage'],
    config: string[] = [],
  ): Promise<AppServerOptions> {
    return {
      ...(await this.requireBinary()),
      ...(cwd ? { cwd } : {}),
      config: [...(this.config.config ?? []), ...config],
      ...(this.config.codexHome ? { codexHome: this.config.codexHome } : {}),
      ...(onMessage ? { onMessage } : {}),
    };
  }

  private async requireBinary(): Promise<CodexBinary> {
    const binary = await this.config.binary();
    if (!binary) throw new Error('Codex is not installed');
    return binary;
  }
}
