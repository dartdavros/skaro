import type { Tool, ToolResult } from './server.ts';
import type { SkaroScope } from './tools.ts';

/** A real external blocker is a durable execution state, not an empty question. */
export function taskBlockerTool(
  handler: (reason: string, scope: SkaroScope) => Promise<ToolResult>,
): Tool<SkaroScope> {
  return {
    name: 'report_task_blocker',
    description:
      'Stop automatic task continuation only for an evidenced external blocker or an explicit owner pause. ' +
      'Include the exact failed prerequisite and what must change. First use the documented setup and Skaro tools ' +
      'to resolve routine configuration and stopped source services yourself. This does not accept criteria, ' +
      'complete or merge the task. Missing owner decisions use the blocking question tool instead. ' +
      'For a read-only follow-up or explicit owner request not to implement, record that limitation here.',
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string', minLength: 1 } },
      required: ['reason'],
      additionalProperties: false,
    },
    available: (scope) => scope.kind === 'task' && !!scope.taskId,
    call: async (args, scope) => {
      if (
        scope.kind !== 'task' ||
        !scope.taskId ||
        typeof args['reason'] !== 'string' ||
        !args['reason'].trim()
      )
        return {
          text: 'A current task and an evidenced blocker reason are required.',
          isError: true,
        };
      return handler(args['reason'].trim(), scope);
    },
  };
}
