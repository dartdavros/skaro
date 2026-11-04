import type { Tool, ToolResult } from './server.ts';
import type { SkaroScope } from './tools.ts';

export interface SecretQuestion {
  id: string;
  header: string;
  question: string;
}

export function readSecretQuestions(value: unknown): SecretQuestion[] | string {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3)
    return 'Request one to three protected fields.';
  const questions: SecretQuestion[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return 'Each protected field must be a question.';
    const { id, header, question } = entry as Record<string, unknown>;
    if (
      typeof id !== 'string' ||
      !/^[a-z][a-z0-9_]{0,63}$/.test(id) ||
      questions.some((item) => item.id === id) ||
      typeof header !== 'string' ||
      !header.trim() ||
      header.length > 12 ||
      typeof question !== 'string' ||
      !question.trim() ||
      question.length > 1000 ||
      Object.keys(entry).some((key) => !['id', 'header', 'question'].includes(key))
    )
      return 'Use unique snake_case IDs, headers of 1–12 characters and explicit question text.';
    questions.push({ id, header: header.trim(), question: question.trim() });
  }
  return questions;
}

/** The tool carries field metadata only; answers use Skaro's existing protected question path. */
export function secretInputTool(
  handler: (questions: SecretQuestion[], scope: SkaroScope) => Promise<ToolResult>,
): Tool<SkaroScope> {
  return {
    name: 'request_secret',
    description:
      'Show one to three protected input fields in this task for API keys, passwords or other ' +
      'credentials required to continue. Supply only field names and explanations, NEVER secret ' +
      'values. Use this before reporting missing credentials as a blocker; do not ask for keys ' +
      'in ordinary chat or option questions. After success, end this turn and wait for the owner ' +
      'to answer the protected card. Answers resume the same task through its private input path.',
    inputSchema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$' },
              header: { type: 'string', minLength: 1, maxLength: 12 },
              question: { type: 'string', minLength: 1, maxLength: 1000 },
            },
            required: ['id', 'header', 'question'],
            additionalProperties: false,
          },
        },
      },
      required: ['questions'],
      additionalProperties: false,
    },
    available: (scope) => scope.kind === 'task' && !!scope.taskId && !!scope.runId,
    call: async (args, scope) => {
      if (scope.kind !== 'task' || !scope.taskId || !scope.runId)
        return { text: 'Protected input requires a current task run.', isError: true };
      const questions = readSecretQuestions(args['questions']);
      return typeof questions === 'string'
        ? { text: questions, isError: true }
        : handler(questions, scope);
    },
  };
}
