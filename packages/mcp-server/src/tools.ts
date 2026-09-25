// Skaro tools for agent sessions (architecture.md 6). The descriptions are what the agent reads.

import type { Tool, ToolResult } from './server.ts';

/** Who is calling: the token of each agent session maps to one scope. */
export interface SkaroScope {
  kind: 'task' | 'project_chat';
  projectId: string;
  taskId?: string;
  runId?: string;
  chatId?: string;
}

export interface MergeTaskArgs {
  /** Short summary of the work, for the task file and the commit message. */
  summary?: string;
}

/**
 * `merge_task` (D-27): the user asks in the task chat to merge, the agent calls this tool, Skaro
 * shows a confirmation card in the feed and merges after the user confirms. The tool does not wait
 * for the decision: it answers right away and the turn goes on (agent-output.md 5.4).
 */
export function mergeTaskTool(
  handler: (args: MergeTaskArgs, scope: SkaroScope) => Promise<ToolResult>,
): Tool<SkaroScope> {
  return {
    name: 'merge_task',
    description:
      'Ask Skaro to merge this task branch into the base branch. Call it only when the user asks ' +
      'to merge. Skaro commits anything left uncommitted in the worktree, checks the merge and ' +
      'shows the user a confirmation card; the merge happens only after the user confirms, so do ' +
      'not wait for it and do not merge, push or switch branches yourself. If the result reports ' +
      'blockers such as conflicts, tell the user what they are.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description:
            'Two or three sentences on what was done, in the language of the conversation. Used ' +
            'for the task summary and the commit message.',
        },
      },
      additionalProperties: false,
    },
    available: (scope) => scope.kind === 'task' && scope.taskId !== undefined,
    call: (args, scope) =>
      handler(
        { ...(typeof args['summary'] === 'string' ? { summary: args['summary'] } : {}) },
        scope,
      ),
  };
}
