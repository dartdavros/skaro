import { isAgentId } from '@skaro/agents';
import type { AppDb, ProjectArtifacts, RunRecord, Task } from '@skaro/core';
import type { AgentId } from '../shared/ipc';
import { taskAgentPreferences, type TaskAgentPreferences } from './task-agent-preferences';
export function taskListAssignment(
  db: AppDb,
  projectId: string,
  task: Task,
  run: RunRecord | undefined,
  artifacts: ProjectArtifacts,
): { agent?: AgentId; model?: string } {
  const saved = db.getSetting<TaskAgentPreferences | null>(
    `task.${projectId}.${task.id}.agent`,
    null,
  );
  if (saved?.followProject && !run) return taskAgentPreferences(artifacts.config, task, saved);
  const agent = saved?.agent ?? run?.agent ?? task.agent;
  if (!isAgentId(agent)) return {};
  const model = saved?.model ?? run?.model ?? task.model;
  return { agent, ...(model ? { model } : {}) };
}
