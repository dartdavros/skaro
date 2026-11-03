import { selectedEffort } from '@skaro/timeline';
import type { AgentId } from '../shared/ipc';
import type { AgentManager } from './agents';

/** UI and native sessions use the same supported effort, with high as Skaro's default. */
export async function withAgentDefaults<T extends { model?: string; effort?: string }>(
  agents: AgentManager,
  agent: AgentId,
  cwd: string,
  settings: T,
): Promise<T> {
  const preset = agents.defaults(agent);
  if (agent === 'skaro') {
    const selected = settings.model ? settings : { ...settings, ...preset };
    if (!selected.model) throw new Error('Select an explicit builtin model route');
    return selected;
  }
  if (!settings.model && preset.model)
    settings = { ...settings, model: preset.model, effort: settings.effort ?? preset.effort };
  const models = await agents.listModels(agent, cwd).catch(() => []);
  const model =
    models.find((m) => m.id === settings.model) ?? models.find((m) => m.isDefault) ?? models[0];
  if (!model) return { ...settings, effort: settings.effort ?? 'high' };
  const effort = selectedEffort(model, settings.effort);
  const { effort: _effort, ...rest } = settings;
  return { ...rest, model: model.id, ...(effort ? { effort } : {}) } as T;
}
