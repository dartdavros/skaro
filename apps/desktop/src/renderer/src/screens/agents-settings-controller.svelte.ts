import type { AgentModel, AgentUserConfig } from '@skaro/timeline';
import { agentDefaultsKey, type AgentId } from '../../../shared/ipc';
import type { AgentsSettingsProps } from './agents-settings-props';
export function createAgentsSettingsController(p: AgentsSettingsProps) {
  const models = $state<Partial<Record<AgentId, AgentModel[]>>>({});
  const defaults = $state<Partial<Record<AgentId, { model?: string; effort?: string }>>>({});
  const spin = $state<Partial<Record<AgentId, number>>>({});
  const busy = $state<Partial<Record<AgentId, boolean>>>({});
  /** "Ваши настройки агента", read for the install state it was read with. */
  const configs = $state<
    Partial<Record<AgentId, { installed: boolean; value?: AgentUserConfig; failed?: boolean }>>
  >({});

  $effect(() => {
    for (const a of p.agents) {
      if (a.checking || a.download) continue;
      if (configs[a.id]?.installed !== a.installed) void loadConfig(a.id, a.installed);
    }
  });

  async function loadConfig(id: AgentId, installed: boolean): Promise<void> {
    configs[id] = { installed };
    try {
      const value = await window.skaro.invoke('agents.config', id);
      if (configs[id]?.installed === installed) configs[id] = { installed, value };
    } catch {
      if (configs[id]?.installed === installed) configs[id] = { installed, failed: true };
    }
  }

  /** The home folder shows as "~": C:/Users/anna/.claude → ~/.claude. */

  // Models come from the agent itself, so only a downloaded agent has them.
  $effect(() => {
    for (const a of p.agents) {
      if (a.installed && !models[a.id]) void loadModels(a.id);
    }
  });

  async function loadModels(id: AgentId): Promise<void> {
    const saved = (await window.skaro.invoke('app.getSetting', agentDefaultsKey(id))) as {
      model?: string;
      effort?: string;
    } | null;
    defaults[id] = saved ?? {};
    try {
      models[id] = await window.skaro.invoke('agents.models', id, '');
    } catch {
      models[id] = [];
    }
  }

  function modelOf(id: AgentId): AgentModel | undefined {
    const list = models[id] ?? [];
    return (
      list.find((m) => m.id === defaults[id]?.model) ?? list.find((m) => m.isDefault) ?? list[0]
    );
  }

  function save(id: AgentId, next: { model?: string; effort?: string }): void {
    defaults[id] = next;
    void window.skaro.invoke('app.setSetting', agentDefaultsKey(id), next);
  }

  async function run(id: AgentId, action: () => Promise<unknown>): Promise<void> {
    busy[id] = true;
    try {
      await action();
    } catch {
      // The agent card shows the state the main process reports.
    } finally {
      busy[id] = false;
    }
  }

  return {
    p,
    get models() {
      return models;
    },
    get defaults() {
      return defaults;
    },
    get spin() {
      return spin;
    },
    get busy() {
      return busy;
    },
    get configs() {
      return configs;
    },
    loadConfig,
    loadModels,
    modelOf,
    save,
    run,
  };
}
export type AgentsSettingsController = ReturnType<typeof createAgentsSettingsController>;
