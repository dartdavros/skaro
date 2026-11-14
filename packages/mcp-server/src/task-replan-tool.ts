import type { Tool } from './server.ts';
import type { SkaroScope } from './tools.ts';
import {
  guarded,
  inChat,
  list,
  optional,
  record,
  strings,
  TASK_SCHEMA,
  tasks,
  text,
  ToolArgsError,
  uniqueRefs,
} from './project-tool-args.ts';
import { TASK_DECOMPOSITION_RULES } from './task-decomposition.ts';
import type { ProposedTaskArgs } from './project-tool-model.ts';

export interface ReplannedTaskArgs extends ProposedTaskArgs {
  id?: string;
  sources: string[];
  milestone?: string;
  order: number;
}

export interface ReplanTasksArgs {
  key: string;
  title: string;
  taskIds: string[];
  tasks: ReplannedTaskArgs[];
  deleteIds?: string[];
  revisionReason?: string;
}

export function parseTaskReplan(args: Record<string, unknown>): ReplanTasksArgs {
  const key = text(args, 'key');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key)) throw new ToolArgsError('Invalid replan key.');
  const taskIds = strings(args, 'task_ids').map((id) => id.toUpperCase());
  if (!taskIds.length || new Set(taskIds).size !== taskIds.length)
    throw new ToolArgsError('task_ids must contain distinct existing task IDs.');
  const deleteIds =
    args['delete_ids'] === undefined
      ? []
      : strings(args, 'delete_ids').map((id) => id.toUpperCase());
  if (new Set(deleteIds).size !== deleteIds.length || deleteIds.some((id) => !taskIds.includes(id)))
    throw new ToolArgsError('delete_ids must be distinct source task IDs.');
  const revisionReason =
    args['revision_reason'] === undefined ? undefined : text(args, 'revision_reason');
  const raw = list(args, 'tasks', true);
  if (!raw.length && !deleteIds.length)
    throw new ToolArgsError('A replan needs resulting tasks or explicit delete_ids.');
  raw.forEach((value) => text(record(value, 'tasks[]'), 'ref'));
  const parsed = tasks(args, '', true).map((task, i) => {
    const value = record(raw[i], 'tasks[]');
    const order = value['order'];
    if (!Number.isSafeInteger(order) || Number(order) < 0)
      throw new ToolArgsError('Task order must be a non-negative integer.');
    const sources = strings(value, 'sources').map((id) => id.toUpperCase());
    if (!sources.length || new Set(sources).size !== sources.length)
      throw new ToolArgsError('Each resulting task needs distinct sources.');
    return {
      ...task,
      ...optional(value, 'id'),
      ...optional(value, 'milestone'),
      sources,
      order: Number(order),
    };
  });
  uniqueRefs(parsed);
  return {
    key,
    title: text(args, 'title'),
    taskIds,
    tasks: parsed,
    ...(deleteIds.length ? { deleteIds } : {}),
    ...(revisionReason ? { revisionReason } : {}),
  };
}

export function replanTasksTool(
  handler: (args: ReplanTasksArgs, scope: SkaroScope) => Promise<import('./server.ts').ToolResult>,
): Tool<SkaroScope> {
  return {
    name: 'replan_tasks',
    description:
      'Propose ONE replacement package for existing tasks that have never started. Read get_project_context first. ' +
      'Use task_ids for all source tasks and tasks for their complete replacements: merge, split, move or reorder. ' +
      'Preserve all goals, requirements and acceptance criteria. Each output lists its sources; reuse an original id whenever possible, ' +
      'Keep each existing acceptance criterion text in at least one output mapped to that source; do not rewrite requirements during a replan. ' +
      'omit id only for a new task. Use local refs or existing task IDs in depends_on, and explicit order and milestone (omit for no milestone). ' +
      'External dependents are rewired from each source to all its replacements and shown in the same diff. ' +
      'For owner-requested deletion, list source IDs in delete_ids and omit their replacements; tasks may be empty for deletion only. Incoming dependencies on deleted tasks are removed in the same reviewed diff. ' +
      'For owner-requested corrections of requirements or dependencies, provide revision_reason and the complete revised outputs; their criteria and dependency lists then replace the originals. Without revision_reason preserve every original criterion and inherited dependency. ' +
      'Previously run, queued, scheduled, archived and non-todo tasks cannot be changed. ' +
      'The owner applies or rejects the ENTIRE package once; no files or worktrees are changed by this proposal. ' +
      'The same key is idempotent; use a new key for a revised proposal. Never bypass this tool with update_task or direct file edits.\n\n' +
      TASK_DECOMPOSITION_RULES,
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        title: { type: 'string' },
        task_ids: { type: 'array', minItems: 1, items: { type: 'string' } },
        delete_ids: { type: 'array', items: { type: 'string' } },
        revision_reason: {
          type: 'string',
          minLength: 1,
          description:
            'Explicit owner-requested scope correction. Explain what requirements or dependencies must change; the owner reviews the entire diff.',
        },
        tasks: {
          type: 'array',
          minItems: 0,
          items: {
            ...TASK_SCHEMA,
            properties: {
              ...TASK_SCHEMA.properties,
              id: { type: 'string', description: 'Source task ID to retain. Omit for a new task.' },
              sources: { type: 'array', minItems: 1, items: { type: 'string' } },
              milestone: {
                type: 'string',
                description: 'Existing milestone ID. Omit for no milestone.',
              },
              order: { type: 'integer', minimum: 0 },
            },
            required: [...TASK_SCHEMA.required, 'ref', 'sources', 'order'],
          },
        },
      },
      required: ['key', 'title', 'task_ids', 'tasks'],
      additionalProperties: false,
    },
    available: inChat,
    call: guarded(parseTaskReplan, async (args, scope) => {
      if (!inChat(scope))
        return { text: 'Replanning is available only in a project chat.', isError: true };
      return handler(args, scope);
    }),
  };
}
