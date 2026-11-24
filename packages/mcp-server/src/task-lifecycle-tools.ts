import { TASK_STATUSES, type TaskStatus } from '@skaro/core';
import { guarded, inChat, text, ToolArgsError } from './project-tool-args.ts';
import type { Tool, ToolResult } from './server.ts';
import type { SkaroScope } from './tools.ts';

const taskIdSchema = { type: 'string', description: 'Existing task ID (T-019).' };

function taskId(args: Record<string, unknown>): string {
  const id = text(args, 'task_id');
  if (!/^T-\d+$/.test(id)) throw new ToolArgsError('Use the exact existing task ID (T-019).');
  return id;
}

export function taskLifecycleTools(handlers: {
  delete: (id: string, scope: SkaroScope) => Promise<ToolResult>;
  setStatus: (id: string, status: TaskStatus, scope: SkaroScope) => Promise<ToolResult>;
}): Tool<SkaroScope>[] {
  return [
    {
      name: 'delete_task',
      description:
        'Permanently delete the exact task the owner explicitly asked to delete, including started or archived tasks. Uses the task board cleanup, removes incoming dependency links, and can remove task-owned checkout, branch and environment. Do not delete on an inferred request. Use replan_tasks for a reviewed graph rewrite.',
      inputSchema: {
        type: 'object',
        properties: { task_id: taskIdSchema },
        required: ['task_id'],
        additionalProperties: false,
      },
      available: inChat,
      call: guarded(taskId, handlers.delete),
    },
    {
      name: 'set_task_status',
      description:
        'Set the exact existing task status explicitly requested by the owner as a board correction. Does not start a run, accept criteria, publish C4 or merge code. For delivery of implemented work use the normal task review, submission and merge workflow.',
      inputSchema: {
        type: 'object',
        properties: { task_id: taskIdSchema, status: { type: 'string', enum: TASK_STATUSES } },
        required: ['task_id', 'status'],
        additionalProperties: false,
      },
      available: inChat,
      call: guarded(
        (args) => {
          const id = taskId(args);
          const status = TASK_STATUSES.find((value) => value === args['status']);
          if (!status) throw new ToolArgsError('Use a status listed in the tool schema.');
          return { id, status };
        },
        ({ id, status }, scope) => handlers.setStatus(id, status, scope),
      ),
    },
  ];
}
