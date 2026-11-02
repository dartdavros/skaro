import type { BuiltinSessionStart } from '@skaro/timeline';
import { requireBuiltinSessionPolicy } from './builtin-session-policy';

export function requireBuiltinTaskSessionPolicy(
  expected: Parameters<typeof requireBuiltinSessionPolicy>[0],
  config: BuiltinSessionStart,
) {
  const { scope } = expected;
  if (
    scope.kind !== 'task' ||
    !scope.taskId ||
    !scope.runId ||
    Object.keys(scope).some((name) => !['kind', 'projectId', 'taskId', 'runId'].includes(name))
  )
    throw new Error('Builtin startup requires a task/run scope');
  requireBuiltinSessionPolicy(expected, config);
}
