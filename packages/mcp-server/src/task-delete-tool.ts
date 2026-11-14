import type { Tool } from './server.ts';
import type { SkaroScope } from './tools.ts';
import { replanTasksTool } from './task-replan-tool.ts';

/** Deletion uses the same reviewed graph, durable journal, recovery and revert as replanning. */
export function deleteTasksTool(handler: Parameters<typeof replanTasksTool>[0]): Tool<SkaroScope> {
  const replan = replanTasksTool(handler);
  return {
    ...replan,
    name: 'delete_tasks',
    description:
      'Propose deletion of explicitly owner-selected, never-started tasks and remove their incoming dependency edges in ONE reviewed diff. Read get_project_context first. Nothing changes until owner acceptance. Use a stable key for retries. Started, queued or archived work is protected; explain a refusal in chat, never use computer control, UI automation or shell edits to bypass it.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        title: { type: 'string' },
        task_ids: { type: 'array', minItems: 1, items: { type: 'string' } },
      },
      required: ['key', 'title', 'task_ids'],
      additionalProperties: false,
    },
    call: (args, scope, identity) =>
      replan.call(
        {
          key: args['key'],
          title: args['title'],
          task_ids: args['task_ids'],
          delete_ids: args['task_ids'],
          tasks: [],
        },
        scope,
        identity,
      ),
  };
}
