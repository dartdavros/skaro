// Models of an agent for the board's dialogs, with the model and effort a task starts with.

import type { AgentModel } from '@skaro/timeline';
import { t } from '@skaro/ui';
import { agentDefaultsKey, type AgentId } from '../../../shared/ipc';

export function effortLabel(id: string): string {
  const key = `effort.${id}`;
  const text = t(key);
  return text === key ? id : text;
}

export class AgentModels {
  list = $state<AgentModel[]>([]);
  /** Defaults from "Настройки" → "Агенты". */
  preset = $state<{ model?: string; effort?: string }>({});
  private token = 0;

  async load(agent: AgentId, projectId: string): Promise<void> {
    const token = ++this.token;
    const [list, preset] = await Promise.all([
      window.skaro.invoke('agents.models', agent, projectId).catch(() => []),
      window.skaro.invoke('app.getSetting', agentDefaultsKey(agent)).catch(() => null),
    ]);
    if (token !== this.token) return;
    this.list = list;
    this.preset = (preset as { model?: string; effort?: string } | null) ?? {};
  }

  /** The chosen model, else the default of Settings, else the agent's own default. */
  model(id?: string): AgentModel | undefined {
    return (
      this.list.find((m) => m.id === id) ??
      this.list.find((m) => m.id === this.preset.model) ??
      this.list.find((m) => m.isDefault) ??
      this.list[0]
    );
  }

  /** Effort of a model: the chosen one if the model has it, else the default. */
  effort(model: AgentModel | undefined, id?: string): string | undefined {
    if (!model) return undefined;
    const has = (e?: string) => (e && model.efforts.some((x) => x.id === e) ? e : undefined);
    return (
      has(id) ??
      (model.id === this.preset.model ? has(this.preset.effort) : undefined) ??
      model.defaultEffort ??
      model.efforts[Math.floor(model.efforts.length / 2)]?.id
    );
  }
}
