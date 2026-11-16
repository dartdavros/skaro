import type { Tool, ToolResult } from './server.ts';
import type { SkaroScope } from './tools.ts';

/** Cancellation retires a request; it never supplies answers, consent or execution intent. */
export function questionCancelTool(
  handler: (id: string, reason: string, scope: SkaroScope) => Promise<ToolResult>,
): Tool<SkaroScope> {
  return {
    name: 'cancel_question',
    description:
      'Cancel an obsolete question card in this exact conversation after the owner replaced its request or explicitly asked to cancel it. Supply its exact question_id and owner reason. This does not fill secret fields, grant permission, resolve an external incident or resume task execution. Do not cancel an unanswered decision merely to bypass it.',
    inputSchema: {
      type: 'object',
      properties: {
        question_id: { type: 'string', minLength: 1 },
        reason: { type: 'string', minLength: 1 },
      },
      required: ['question_id', 'reason'],
      additionalProperties: false,
    },
    available: (scope) =>
      (scope.kind === 'task' && !!scope.taskId && !!scope.runId) ||
      (scope.kind === 'integration' && !!scope.integrationId && !!scope.taskId && !!scope.runId) ||
      (scope.kind === 'project_chat' && !!scope.chatId),
    call: async (args, scope) => {
      if (
        typeof args.question_id !== 'string' ||
        !args.question_id.trim() ||
        typeof args.reason !== 'string' ||
        !args.reason.trim()
      )
        return {
          text: 'An exact question_id and owner cancellation reason are required.',
          isError: true,
        };
      return handler(args.question_id, args.reason, scope);
    },
  };
}
