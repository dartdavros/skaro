import type { AgentSettings, ChatSettings } from '../../../shared/ipc';

/** The shared modal retains exact chat choices, including an absent optional budget. */
export function chatModalSettings(settings: ChatSettings): AgentSettings {
  return {
    agent: settings.agent,
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.effort ? { effort: settings.effort } : {}),
    ...(settings.budgetUsd !== undefined ? { budgetUsd: settings.budgetUsd } : {}),
    permissionMode: settings.permissionMode ?? 'ask',
    planFirst: false,
    isolation: 'in-place',
  };
}
