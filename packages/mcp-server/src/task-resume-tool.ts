import type { Tool, ToolResult } from './server.ts';
import type { SkaroScope } from './tools.ts';

export function taskResumeTool(
  handler: (commandId: string, instruction: string, scope: SkaroScope) => Promise<ToolResult>,
): Tool<SkaroScope> {
  return {
    name: 'resume_task',
    description:
      'Resume automatic task execution ONLY when the latest owner message explicitly asks you ' +
      'to implement, fix, verify or continue work. Supply its command_id and an exact quote of ' +
      'that instruction. A question, status request, request for explanation, or discussion of ' +
      'missing prerequisites is NOT authorization. Answer those messages and end the turn. ' +
      'Never use an older task instruction to override the current message. ' +
      'Unanswered decision cards must be answered before resuming.',
    inputSchema: {
      type: 'object',
      properties: {
        command_id: { type: 'string', minLength: 1 },
        instruction: { type: 'string', minLength: 1 },
      },
      required: ['command_id', 'instruction'],
      additionalProperties: false,
    },
    available: (scope) => scope.kind === 'task' && !!scope.taskId && !!scope.runId,
    call: async (args, scope) => {
      if (
        scope.kind !== 'task' ||
        !scope.taskId ||
        !scope.runId ||
        typeof args['command_id'] !== 'string' ||
        !args['command_id'].trim() ||
        typeof args['instruction'] !== 'string' ||
        !args['instruction'].trim()
      )
        return {
          text: 'A current task run, command_id and exact owner instruction are required.',
          isError: true,
        };
      return handler(args['command_id'], args['instruction'], scope);
    },
  };
}
