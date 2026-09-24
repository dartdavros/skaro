// Claude Code adapter (docs/architecture.md 5.1): status, sign-in, models, commands,
// sandbox self-check and sessions, all through the pinned CLI binary.

import { execFile, spawn } from 'node:child_process';
import {
  query,
  type Options,
  type SDKControlInitializeResponse,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentAdapter,
  AgentCommand,
  AgentModel,
  AgentSession,
  AgentStatus,
  SandboxCheck,
  SessionOptions,
} from '@skaro/timeline';
import { CLAUDE_ADAPTER_VERSION } from './projector.ts';
import { ClaudeSession } from './session.ts';

export interface ClaudeAdapterConfig {
  /** Path of the installed pinned binary, or undefined when not installed yet. */
  executable: () => Promise<string | undefined>;
  configDir?: string;
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude-code' as const;
  readonly adapterVersion = CLAUDE_ADAPTER_VERSION;
  private readonly config: ClaudeAdapterConfig;

  constructor(config: ClaudeAdapterConfig) {
    this.config = config;
  }

  async status(): Promise<AgentStatus> {
    const exe = await this.config.executable();
    if (!exe) return { installed: false };
    const version = (await run(exe, ['--version'], this.env())).stdout.trim().split(' ')[0];
    const auth = await run(exe, ['auth', 'status', '--json'], this.env());
    try {
      const status = JSON.parse(auth.stdout) as {
        loggedIn?: boolean;
        email?: string;
        subscriptionType?: string;
      };
      return {
        installed: true,
        version,
        authenticated: status.loggedIn === true,
        account: status.email ?? status.subscriptionType,
      };
    } catch {
      return { installed: true, version, authenticated: false };
    }
  }

  /** `claude auth login` opens the browser; the CLI stores the credentials itself. */
  async login(): Promise<void> {
    const exe = await this.requireExecutable();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(exe, ['auth', 'login'], {
        env: this.env(),
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`claude auth login exited with ${code}`)),
      );
    });
  }

  async listModels(cwd: string): Promise<AgentModel[]> {
    const init = await this.initialize(cwd);
    return init.models.map((m, index) => ({
      id: m.value,
      name: m.displayName,
      description: m.description,
      isDefault: m.value === 'default' || index === 0,
      efforts: (m.supportedEffortLevels ?? []).map((id) => ({ id })),
      images: true,
    }));
  }

  async listCommands(cwd: string): Promise<AgentCommand[]> {
    const init = await this.initialize(cwd);
    return init.commands.map((c) => ({
      name: c.name,
      description: c.description,
      kind: c.builtin ? 'command' : 'skill',
    }));
  }

  /**
   * D-28: the CLI refuses to start with `sandbox.failIfUnavailable` when the platform has no
   * working sandbox, before any model call. Where it starts, the Bash sandbox is in place.
   */
  async checkSandbox(scratchDir: string): Promise<SandboxCheck> {
    try {
      await this.initialize(scratchDir, { sandbox: { enabled: true, failIfUnavailable: true } });
      return { holds: true, detail: 'Bash sandbox available' };
    } catch (error) {
      return { holds: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async start(options: SessionOptions): Promise<AgentSession> {
    const session = new ClaudeSession(options, {
      executable: await this.requireExecutable(),
      ...(this.config.configDir ? { configDir: this.config.configDir } : {}),
    });
    session.start();
    return session;
  }

  /** Starts the CLI without a prompt: models, commands and account come with initialize. */
  private async initialize(
    cwd: string,
    extra: Partial<Options> = {},
  ): Promise<SDKControlInitializeResponse> {
    const q = query({
      prompt: never(),
      options: {
        cwd,
        pathToClaudeCodeExecutable: await this.requireExecutable(),
        env: this.env(),
        ...extra,
      },
    });
    try {
      return await q.initializationResult();
    } finally {
      q.close();
    }
  }

  private async requireExecutable(): Promise<string> {
    const exe = await this.config.executable();
    if (!exe) throw new Error('Claude Code is not installed');
    return exe;
  }

  private env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...(this.config.configDir ? { CLAUDE_CONFIG_DIR: this.config.configDir } : {}),
    };
  }
}

/** Input that never yields: the CLI initializes and waits. */
function never(): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<never>>(() => undefined),
    }),
  };
}

function run(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    execFile(file, args, { env, windowsHide: true, timeout: 30_000 }, (error, stdout) =>
      resolve({ stdout: String(stdout), code: error ? 1 : 0 }),
    );
  });
}
