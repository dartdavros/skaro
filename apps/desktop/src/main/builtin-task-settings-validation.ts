import type { AgentSettings } from '../shared/ipc';
import type { TaskRunEngine } from './task-run-engine';
import { parseBuiltinTaskStart } from './builtin-task-start';

export async function validateBuiltinTaskSettings(ctx: TaskRunEngine, settings: AgentSettings) {
  if (settings.agent !== 'skaro') return;
  if (!ctx.deps.builtinSessions) throw new Error('Builtin task authorization is unavailable');
  await ctx.deps.builtinSessions.resolveStart(
    parseBuiltinTaskStart(settings),
    new AbortController().signal,
  );
  if (ctx.closing) throw new Error('Task controller is closing');
}
