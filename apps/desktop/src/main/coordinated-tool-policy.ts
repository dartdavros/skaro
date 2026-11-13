import type { AppDb, CoordinationOperationInput } from '@skaro/core';
import type { SkaroScope } from '@skaro/mcp-server';
import { stageIdOf } from './task-stage';

/** Runtime resources have their own writer; an environment waiter must not own the project. */
export function environmentToolPolicy(
  db: AppDb,
  name: string,
  args: Record<string, unknown>,
  scope: SkaroScope,
): Pick<CoordinationOperationInput, 'mode' | 'scopeKey'> | undefined {
  const read = Object.keys(args).length === 0;
  if ((name === 'configure_environment' || name === 'setup_environment') && read)
    return { mode: 'observation', scopeKey: `environment-read:${scope.taskId ?? scope.chatId}` };
  if (name !== 'start_environment' && name !== 'configure_environment') return undefined;
  const run = scope.runId ? db.getRun(scope.runId) : undefined;
  if (run && (run.projectId !== scope.projectId || run.taskId !== scope.taskId))
    throw new Error('Environment run is outside the current task');
  const owner = scope.integrationId ?? (run && stageIdOf(run)) ?? scope.taskId;
  if (!owner) throw new Error('Environment operation requires a bound task');
  return { mode: 'control', scopeKey: `environment:${owner}` };
}
