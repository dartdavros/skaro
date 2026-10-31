import type { AgentSettings, ProjectSettings } from '../../../shared/ipc';

/** A first launch follows the project; a resumed task keeps its established settings. */
export function runSettings(
  project: Pick<
    ProjectSettings,
    'defaultAgent' | 'defaultModel' | 'defaultEffort' | 'permissionMode' | 'isolation'
  >,
  task: AgentSettings,
  started: boolean,
): AgentSettings {
  if (started) return { ...task };
  return {
    agent: project.defaultAgent,
    ...(project.defaultModel ? { model: project.defaultModel } : {}),
    effort: project.defaultEffort ?? 'high',
    permissionMode: project.permissionMode,
    isolation: project.isolation,
    planFirst: task.planFirst,
  };
}
