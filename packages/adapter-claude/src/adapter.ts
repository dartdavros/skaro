// Claude Code adapter (docs/architecture.md 5.1): status, sign-in, models, commands,
// sandbox self-check and sessions, all through the pinned CLI binary.

import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
  AgentUserConfig,
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
    // Aliases ("default", "opus") become the model they stand for: the name is the model's own
    // ("Opus 5.5", from "Opus 5.5 · Best for…"), and two aliases of one model are one row.
    const models: AgentModel[] = [];
    init.models.forEach((m, index) => {
      const id = m.value.startsWith('claude-') ? m.value : (m.resolvedModel ?? m.value);
      const isDefault = m.value === 'default' || index === 0;
      const known = models.find((x) => x.id === id);
      if (known) {
        known.isDefault ||= isDefault;
        return;
      }
      const [head, ...rest] = m.description.split(' · ');
      const named = head !== undefined && rest.length > 0 && /\d/.test(head);
      models.push({
        id,
        name: named ? head : m.displayName,
        description: named ? rest.join(' · ') : m.description,
        isDefault,
        efforts: (m.supportedEffortLevels ?? []).map((e) => ({ id: e })),
        images: true,
      });
    });
    return models;
  }

  async listCommands(cwd: string): Promise<AgentCommand[]> {
    const init = await this.initialize(cwd);
    return init.commands.map((c) => ({
      name: c.name,
      description: c.description,
      kind: c.builtin ? 'command' : 'skill',
    }));
  }

  /** MCP servers connect at start; the status is read once none is still connecting. */
  async userConfig(cwd: string): Promise<AgentUserConfig> {
    const dir =
      this.config.configDir ?? process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');
    const q = query({
      prompt: never(),
      options: { cwd, pathToClaudeCodeExecutable: await this.requireExecutable(), env: this.env() },
    });
    try {
      const init = await q.initializationResult();
      let servers = await q.mcpServerStatus();
      for (let i = 0; i < 40 && servers.some((s) => s.status === 'pending'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        servers = await q.mcpServerStatus();
      }
      return {
        dir,
        mcp: servers.map((s) => ({
          name: s.name,
          state:
            s.status === 'connected'
              ? 'ok'
              : s.status === 'needs-auth'
                ? 'needs_auth'
                : s.status === 'disabled'
                  ? 'disabled'
                  : 'failed',
          tools: s.tools?.length ?? 0,
          ...(s.error ? { error: s.error } : {}),
        })),
        skills: init.commands.filter((c) => !c.builtin).length,
        hooks: await countHooks(join(dir, 'settings.json')),
      };
    } finally {
      q.close();
    }
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

/** Hook commands in a settings file: `hooks: { Event: [{ matcher, hooks: [...] }] }`. */
async function countHooks(path: string): Promise<number> {
  try {
    const settings = JSON.parse(await readFile(path, 'utf8')) as { hooks?: unknown };
    const events = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
    let count = 0;
    for (const groups of Object.values(events)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        const hooks = (group as { hooks?: unknown }).hooks;
        count += Array.isArray(hooks) ? hooks.length : 1;
      }
    }
    return count;
  } catch {
    return 0;
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
