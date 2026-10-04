// Skaro tools for agent sessions (architecture.md 6). The descriptions are what the agent reads.

import type { Tool, ToolResult } from './server.ts';

/** Who is calling: the token of each agent session maps to one scope. */
export interface SkaroScope {
  kind: 'task' | 'project_chat';
  projectId: string;
  taskId?: string;
  runId?: string;
  chatId?: string;
  /** The chat imports documentation (architecture.md 12): it stages artifacts, nothing else. */
  importId?: string;
}

export interface MergeTaskArgs {
  /** Short summary of the work, for the task file. */
  summary?: string;
  commitMessage?: string;
}

export interface CriterionVerdict {
  /** 1-based number of the criterion in the task. */
  number: number;
  met: boolean;
  /** How the agent checked it: a command, a test, a measurement. */
  evidence: string;
}

export interface SubmitResultArgs {
  summary: string;
  criteria: CriterionVerdict[];
  commitMessage: string;
}

const COMMIT_MESSAGE =
  'Commit message for merging the task into the base branch. Follow the commit convention of ' +
  'this repository (git log, commitlint config, CONTRIBUTING); if there is none, use ' +
  'Conventional Commits in English (feat: …, fix: …). Subject line first, a body if useful.';

function commitMessage(args: Record<string, unknown>): { commitMessage?: string } {
  const value = typeof args['commit_message'] === 'string' ? args['commit_message'].trim() : '';
  return value ? { commitMessage: value } : {};
}

/** Wrong arguments of `submit_result`: the agent gets the message and can call again. */
function verdicts(value: unknown): CriterionVerdict[] | string {
  if (!Array.isArray(value)) return '"criteria" must be an array.';
  const out: CriterionVerdict[] = [];
  for (const [i, raw] of value.entries()) {
    const v = (raw ?? {}) as Record<string, unknown>;
    if (typeof v['number'] !== 'number' || !Number.isInteger(v['number']) || v['number'] < 1)
      return `criteria[${i}].number must be the criterion number, starting at 1.`;
    if (typeof v['met'] !== 'boolean') return `criteria[${i}].met must be true or false.`;
    if (typeof v['evidence'] !== 'string' || !v['evidence'].trim())
      return `criteria[${i}].evidence must say how you checked the criterion.`;
    out.push({ number: v['number'], met: v['met'], evidence: v['evidence'].trim() });
  }
  return out;
}

/**
 * `submit_result` (architecture.md 7): at the end of the work the agent checks every acceptance
 * criterion and reports a verdict with evidence; Skaro ticks the criteria in the task from it.
 * "Done" is what this report says, not what the agent writes in the chat.
 */
export function submitResultTool(
  handler: (args: SubmitResultArgs, scope: SkaroScope) => Promise<ToolResult>,
): Tool<SkaroScope> {
  return {
    name: 'submit_result',
    description:
      'Report the result of the task before telling the user it is done. Check every acceptance ' +
      'criterion of the task yourself (run the code, the tests, measure) and give a verdict for ' +
      'each one, with the evidence: what you ran or looked at and what you saw. Skaro ticks the ' +
      'criteria in the task from this report. Report a criterion as met only if you verified it; ' +
      'unverified means not met. Call it every time the user asks you to check or submit the ' +
      'result, even if nothing changed since the last call, and again after fixing something.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description:
            'Two or three sentences on what was done, in the language of the conversation.',
        },
        commit_message: { type: 'string', description: COMMIT_MESSAGE },
        criteria: {
          type: 'array',
          description: 'One entry per acceptance criterion of the task, all of them.',
          items: {
            type: 'object',
            properties: {
              number: { type: 'integer', minimum: 1, description: 'Criterion number, from 1.' },
              met: { type: 'boolean' },
              evidence: {
                type: 'string',
                description: 'How it was checked and what the check showed.',
              },
            },
            required: ['number', 'met', 'evidence'],
            additionalProperties: false,
          },
        },
      },
      required: ['summary', 'criteria', 'commit_message'],
      additionalProperties: false,
    },
    available: (scope) => scope.kind === 'task' && scope.taskId !== undefined,
    call: async (args, scope) => {
      const criteria = verdicts(args['criteria']);
      if (typeof criteria === 'string') return { text: criteria, isError: true };
      const summary = typeof args['summary'] === 'string' ? args['summary'].trim() : '';
      if (!summary) return { text: '"summary" must not be empty.', isError: true };
      const { commitMessage: message } = commitMessage(args);
      if (!message) return { text: '"commit_message" must not be empty.', isError: true };
      return handler({ summary, criteria, commitMessage: message }, scope);
    },
  };
}

/**
 * `start_environment` (task-environments.md): the agent asks for running services, Skaro starts
 * the task's own disposable copy within the limit of parallel runs and answers with its addresses.
 */
export function startEnvironmentTool(
  handler: (scope: SkaroScope) => Promise<ToolResult>,
): Tool<SkaroScope> {
  return {
    name: 'start_environment',
    description:
      "Start this task's own environment: the project's services running on the task's sources, " +
      'with a disposable copy of the data of the main environment (its existing accounts ' +
      'included). Call it when you need running services: before browser verification, for ' +
      'integration checks, to read service logs. It returns when the services are ready and ' +
      'gives their addresses; the first call builds images and copies data and may take several ' +
      'minutes. Skaro stops the environment while the task is idle and removes it when the task ' +
      'is merged, so call it again whenever you need the services: a running environment answers ' +
      'at once. Do not start, recreate or re-point the services yourself.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    available: (scope) => scope.kind === 'task' && scope.taskId !== undefined,
    call: (_args, scope) => handler(scope),
  };
}

/**
 * `merge_task` (D-27): the user asks in the task chat to merge, the agent calls this tool, Skaro
 * follows the automatic/manual setting. Completed tasks return their status without a new card.
 * In manual mode the tool does not wait for the card decision (agent-output.md 5.4).
 */
export function mergeTaskTool(
  handler: (args: MergeTaskArgs, scope: SkaroScope) => Promise<ToolResult>,
): Tool<SkaroScope> {
  return {
    name: 'merge_task',
    description:
      'Ask Skaro to merge this task branch into the base branch. Call it only when the user asks ' +
      'to merge. Skaro follows the current merge setting: automatic mode merges immediately ' +
      'when unblocked; manual mode shows a confirmation card without waiting for the decision. ' +
      'An already merged or completed task returns its status without another card or Git changes. ' +
      'Do not call this tool to reconfirm a merge reported by submit_result. Do not merge, push ' +
      'or switch branches yourself. If the result reports blockers such as conflicts, tell the user.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description:
            'Two or three sentences on what was done, in the language of the conversation. Used ' +
            'for the task summary.',
        },
        commit_message: { type: 'string', description: COMMIT_MESSAGE },
      },
      additionalProperties: false,
    },
    available: (scope) => scope.kind === 'task' && scope.taskId !== undefined,
    call: (args, scope) =>
      handler(
        {
          ...(typeof args['summary'] === 'string' ? { summary: args['summary'] } : {}),
          ...commitMessage(args),
        },
        scope,
      ),
  };
}
