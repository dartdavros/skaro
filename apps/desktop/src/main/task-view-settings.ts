import { requireAgentId } from '@skaro/agents';
import type { ProjectArtifacts, Task } from '@skaro/core';
import type { AgentSettings } from '../shared/ipc';
import type { TaskRunEngine } from './task-run-engine';
import { key, settingsKey } from './task-run-helpers';
import { taskAgentPreferences, type TaskAgentPreferences } from './task-agent-preferences';
import { builtinRunSettings } from './builtin-run-settings';

/** A running builtin task always displays its exact recorded permissions and checkout. */
export function taskViewSettings(
  ctx: TaskRunEngine,
  projectId: string,
  task: Task,
  artifacts: ProjectArtifacts,
): AgentSettings {
  const running = ctx.active.get(key(projectId, task.id));
  if (running?.run.agent === 'skaro') return builtinRunSettings(ctx, running);
  const saved = ctx.deps.db.getSetting<TaskAgentPreferences | null>(
    settingsKey(projectId, task.id),
    null,
  );
  const active = ctx.active.get(key(projectId, task.id));
  const preferences = taskAgentPreferences(
    artifacts.config,
    task,
    saved,
    active
      ? {
          agent: active.run.agent,
          model: active.timeline.state.session?.model || active.run.model,
        }
      : undefined,
  );
  const configured = preferences.agent;
  // A started task keeps its agent; a new one goes to a ready agent if its own is absent.
  const started = ctx.active.has(key(projectId, task.id));
  const agent = saved?.agent || started ? configured : ctx.deps.agents.readyAgent(configured);
  const { model, effort } = preferences;
  return {
    agent: requireAgentId(agent),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    permissionMode: saved?.permissionMode ?? artifacts.config.permissionMode,
    planFirst: saved?.planFirst ?? false,
    ...(agent === 'skaro' && saved?.budgetUsd !== undefined ? { budgetUsd: saved.budgetUsd } : {}),
    isolation: saved?.isolation ?? artifacts.config.isolation,
  };
}
