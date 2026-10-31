import { requireAgentId } from '@skaro/agents';
import type { ProjectConfig, Task } from '@skaro/core';
import type { AgentSettings } from '../shared/ipc';

export type TaskAgentPreferences = Partial<AgentSettings> & { followProject?: boolean };

export function taskAgentPreferences(
  config: ProjectConfig,
  task: Pick<Task, 'agent' | 'model'>,
  saved: TaskAgentPreferences | null,
  started?: { agent: string; model?: string },
): Pick<AgentSettings, 'agent' | 'model' | 'effort'> {
  if (started) {
    const model = saved?.model ?? started.model ?? task.model;
    return {
      agent: requireAgentId(started.agent),
      ...(model ? { model } : {}),
      effort: saved?.effort ?? 'high',
    };
  }
  const own = saved?.followProject ? undefined : saved;
  const configured =
    own?.agent ?? (saved?.followProject ? undefined : task.agent) ?? config.defaultAgent;
  const model =
    own?.model ?? (saved?.followProject ? undefined : task.model) ?? config.defaultModel;
  const effort =
    own?.effort ??
    (configured === config.defaultAgent && (!model || model === config.defaultModel)
      ? config.defaultEffort
      : undefined) ??
    'high';
  return {
    agent: requireAgentId(configured),
    ...(model ? { model } : {}),
    effort,
  };
}

export function agentDefaultsChanged(before: ProjectConfig, after: ProjectConfig): boolean {
  return (
    before.defaultAgent !== after.defaultAgent ||
    before.defaultModel !== after.defaultModel ||
    (before.defaultEffort ?? 'high') !== (after.defaultEffort ?? 'high')
  );
}
