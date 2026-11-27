import type { SkaroScope, Tool, ToolResult } from '@skaro/mcp-server';
import { OWNER_QUESTION_PREFIX, type Interaction } from '@skaro/timeline';
import { parseIncidentOptions } from './incident-model-plan';
import type { TaskRunEngine } from './task-run-engine';
import { taskTool } from './task-run-access';

export type OwnerQuestion = Extract<Interaction, { kind: 'question' }>;

export function ownerQuestionTool(
  open: (scope: SkaroScope, question: OwnerQuestion) => Promise<ToolResult>,
): Tool<SkaroScope> {
  return {
    name: 'ask_owner',
    description:
      'Open a pinned question for a concrete product decision or permission. Give actionable options and their consequences. Continue independent work while the owner answers. Use request_secret for protected input.',
    available: (scope) =>
      !scope.importId &&
      ((scope.kind === 'task' && !!scope.taskId && !!scope.runId) ||
        (scope.kind === 'project_chat' && !!scope.chatId)),
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', minLength: 1, maxLength: 4000 },
        options: {
          type: 'array',
          minItems: 2,
          maxItems: 3,
          items: {
            type: 'object',
            properties: { label: { type: 'string' }, description: { type: 'string' } },
            required: ['label', 'description'],
            additionalProperties: false,
          },
        },
      },
      required: ['question', 'options'],
      additionalProperties: false,
    },
    call: (args, scope, identity) => {
      const question = typeof args.question === 'string' ? args.question.trim() : '';
      if (!identity || !question || question.length > 4000)
        throw new Error('An active conversation and a concrete owner question are required');
      return open(scope, {
        id: OWNER_QUESTION_PREFIX + identity.id,
        kind: 'question',
        delivery: 'async',
        questions: [
          {
            id: 'decision',
            header: scope.taskId ?? '',
            text: question,
            multi: false,
            allowFreeText: true,
            options: parseIncidentOptions(args.options),
          },
        ],
      });
    },
  };
}

export function sameOwnerQuestion(left: Interaction, right: OwnerQuestion): boolean {
  if (left.kind !== 'question' || !left.id.startsWith(OWNER_QUESTION_PREFIX)) return false;
  return left.id === right.id || JSON.stringify(left.questions) === JSON.stringify(right.questions);
}

export function ownerQuestionReply() {
  return {
    text: 'The owner question is open above the composer. Continue independent work. Use the answer only for the action it authorizes.',
  };
}

export function openTaskOwnerQuestion(
  ctx: TaskRunEngine,
  scope: SkaroScope,
  interaction: OwnerQuestion,
) {
  return taskTool(ctx, scope, async () => {
    const active = ctx.requireActive(scope.projectId, scope.taskId!);
    if (!active.timeline.state.interactions.some((i) => sameOwnerQuestion(i, interaction))) {
      ctx.history.skaroEvent(active, { t: 'interaction.opened', interaction });
      ctx.history.flush(active);
    }
    return ownerQuestionReply();
  });
}
