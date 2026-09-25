// Agents in the main process (architecture.md 5): pinned binaries downloaded on first use,
// adapters, account status, models and "/" commands, and the sandbox self-check (D-28).

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ClaudeAdapter } from '@skaro/adapter-claude';
import { CodexAdapter } from '@skaro/adapter-codex';
import { AgentInstaller, agentPackage, type AgentId } from '@skaro/core';
import type { AgentAdapter, AgentCommand, AgentModel, SandboxCheck } from '@skaro/timeline';
import type { AgentInfo } from '../shared/ipc';

export const AGENT_IDS: readonly AgentId[] = ['claude-code', 'codex'];

/** Approximate download size shown before the first download (bytes). */
const DOWNLOAD_SIZE: Record<AgentId, number> = {
  'claude-code': 230e6,
  codex: 90e6,
};

interface Store {
  getSetting(key: string): unknown;
  setSetting(key: string, value: unknown): void;
}

export class AgentManager {
  private readonly installer: AgentInstaller;
  private readonly adapters: Record<AgentId, AgentAdapter>;
  private readonly info = new Map<AgentId, AgentInfo>();
  private readonly downloads = new Map<AgentId, Promise<void>>();
  private readonly models = new Map<string, Promise<AgentModel[]>>();
  private readonly commands = new Map<string, Promise<AgentCommand[]>>();
  private readonly scratchDir: string;
  private readonly store: Store;
  private readonly onChange: (agents: AgentInfo[]) => void;

  constructor(options: {
    agentsDir: string;
    scratchDir: string;
    store: Store;
    openUrl: (url: string) => void;
    onChange: (agents: AgentInfo[]) => void;
  }) {
    this.installer = new AgentInstaller({ dir: options.agentsDir });
    this.scratchDir = options.scratchDir;
    this.store = options.store;
    this.onChange = options.onChange;
    this.adapters = {
      'claude-code': new ClaudeAdapter({
        executable: async () => (await this.installer.installed('claude-code'))?.binary,
      }),
      codex: new CodexAdapter({
        binary: async () => {
          const installed = await this.installer.installed('codex');
          return installed && { binary: installed.binary, pathDirs: installed.pathDirs };
        },
        openUrl: options.openUrl,
      }),
    };
    for (const id of AGENT_IDS) {
      this.info.set(id, { id, installed: false, sizeBytes: DOWNLOAD_SIZE[id], checking: true });
    }
  }

  adapter(id: AgentId): AgentAdapter {
    return this.adapters[id];
  }

  list(): AgentInfo[] {
    return AGENT_IDS.map((id) => this.info.get(id)!);
  }

  /** Re-reads install and sign-in state of every agent. */
  async refresh(): Promise<AgentInfo[]> {
    await Promise.all(AGENT_IDS.map((id) => this.refreshOne(id)));
    return this.list();
  }

  async refreshOne(id: AgentId): Promise<AgentInfo> {
    const previous = this.info.get(id)!;
    let next: AgentInfo;
    try {
      const status = await this.adapters[id].status();
      next = {
        id,
        installed: status.installed,
        version: status.installed ? agentPackage(id).version : undefined,
        authenticated: status.authenticated,
        account: status.account,
        sizeBytes: DOWNLOAD_SIZE[id],
        ...(previous.download ? { download: previous.download } : {}),
      };
    } catch (error) {
      next = {
        id,
        installed: (await this.installer.installed(id)) !== undefined,
        sizeBytes: DOWNLOAD_SIZE[id],
        error: error instanceof Error ? error.message : String(error),
      };
    }
    this.set(next);
    return next;
  }

  /** Downloads the pinned binary; progress goes out through `onChange`. */
  install(id: AgentId): Promise<void> {
    const running = this.downloads.get(id);
    if (running) return running;
    const task = (async () => {
      let lastReport = 0;
      this.patch(id, { download: { received: 0 } });
      try {
        await this.installer.install(id, (received, total) => {
          const now = Date.now();
          if (now - lastReport < 200 && received !== total) return;
          lastReport = now;
          this.patch(id, { download: { received, ...(total ? { total } : {}) } });
        });
        this.patch(id, { download: undefined, error: undefined });
      } catch (error) {
        this.patch(id, {
          download: undefined,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        this.downloads.delete(id);
      }
      await this.refreshOne(id);
    })();
    this.downloads.set(id, task);
    return task;
  }

  async login(id: AgentId): Promise<void> {
    await this.adapters[id].login();
    await this.refreshOne(id);
  }

  /** Models of an agent (cached per working folder). */
  listModels(id: AgentId, cwd: string): Promise<AgentModel[]> {
    return this.cached(this.models, `${id}\n${cwd}`, () => this.adapters[id].listModels(cwd));
  }

  listCommands(id: AgentId, cwd: string): Promise<AgentCommand[]> {
    return this.cached(this.commands, `${id}\n${cwd}`, () => this.adapters[id].listCommands(cwd));
  }

  /** D-28 self-check before the first run, remembered per agent version. */
  async sandbox(id: AgentId): Promise<SandboxCheck> {
    const key = `agents.${id}.sandbox`;
    const version = agentPackage(id).version;
    const saved = this.store.getSetting(key) as (SandboxCheck & { version: string }) | null;
    if (saved && saved.version === version) return saved;
    const dir = join(this.scratchDir, 'sandbox-check');
    await mkdir(dir, { recursive: true });
    const check = await this.adapters[id].checkSandbox(dir);
    this.store.setSetting(key, { ...check, version });
    return check;
  }

  private cached<T>(
    cache: Map<string, Promise<T>>,
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const hit = cache.get(key);
    if (hit) return hit;
    const promise = load();
    cache.set(key, promise);
    // Failures are not cached: "Повторить" asks again.
    promise.catch(() => cache.delete(key));
    return promise;
  }

  private patch(id: AgentId, patch: Partial<AgentInfo>): void {
    const next = { ...this.info.get(id)!, ...patch };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (next as Record<string, unknown>)[k];
    }
    this.set(next);
  }

  private set(info: AgentInfo): void {
    this.info.set(info.id, info);
    this.onChange(this.list());
  }
}
