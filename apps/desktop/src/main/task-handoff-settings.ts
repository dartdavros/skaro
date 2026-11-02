import { agentDefinition, agentRegistration } from '@skaro/agents';
import type { AgentSettings } from '../shared/ipc';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import type { BuiltinTaskStart } from './builtin-task-start';
import { parseBuiltinTaskStart } from './builtin-task-start';
import { key } from './task-run-helpers';

export type TaskHandoffSettings = AgentSettings | BuiltinTaskStart;

/** Preflight the target before revoking the source or publishing a successor. */
export async function prepareTaskHandoff(
  ctx: TaskRunEngine,
  active: ActiveRun,
  next: TaskHandoffSettings,
  signal: AbortSignal,
) {
  const current = () => {
    signal.throwIfAborted();
    const latest = ctx.deps.db.listRuns(active.projectId, active.taskId)[0];
    if (
      ctx.closing ||
      ctx.active.get(key(active.projectId, active.taskId)) !== active ||
      latest?.id !== active.run.id
    )
      throw new Error('The task changed during handoff preparation');
    if ((next.isolation === 'worktree') !== !!active.run.worktree)
      throw new Error('Keep the existing isolation of a started task.');
  };
  current();
  if (next.agent === 'skaro') {
    if (!ctx.deps.builtinSessions) throw new Error('Builtin task authorization is unavailable');
    const settings = await ctx.deps.builtinSessions.resolveStart(
      parseBuiltinTaskStart(next),
      signal,
    );
    current();
    return { settings, adapterVersion: ctx.deps.builtinSessions.adapterVersion };
  }
  await ctx.views.ensureAgent(next.agent);
  const settings = await ctx.views.withDefaults(
    next.agent,
    ctx.project(active.projectId).root,
    next,
  );
  current();
  return { settings, adapterVersion: ctx.deps.agents.adapter(settings.agent).adapterVersion };
}

/** The existing handoff notice can name a bundled runtime without activating its product picker. */
export function handoffAgentName(id: string): string {
  const entry = agentRegistration(id);
  if ('stage' in entry) {
    if (id !== 'skaro' || entry.stage !== 'runtime-core')
      throw new Error('Agent runtime is unavailable');
    return 'Skaro';
  }
  return agentDefinition(id).presentation.name;
}
