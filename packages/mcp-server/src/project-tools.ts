// Tools of the project chat (architecture.md 6, agent-output.md 5.4): read the project, propose
// documents, ADRs, milestones and tasks. Proposals never hold the turn: the tool answers at once
// and the user decides in a card.

import type { Tool, ToolResult } from './server.ts';
import type { SkaroScope } from './tools.ts';

/** A task the agent proposes; `ref` lets tasks of one call depend on each other. */
export interface ProposedTaskArgs {
  ref: string;
  title: string;
  goal: string;
  criteria: string[];
  notes?: string;
  /** Refs of tasks in the same call or ids of existing tasks (T-004). */
  dependsOn: string[];
}

export interface WriteDocArgs {
  /** brief.md, architecture.md or docs/<name>.md, inside .skaro/. */
  path: string;
  content: string;
  summary?: string;
}

export interface ProposeAdrArgs {
  title: string;
  context: string;
  decision: string;
  consequences: string;
  replaces?: string;
  summary?: string;
}

export interface ProposeMilestonesArgs {
  milestones: { title: string; goal: string; doneWhen: string; tasks: ProposedTaskArgs[] }[];
}

export interface ProposeTasksArgs {
  /** Existing milestone the tasks go to. */
  milestone?: string;
  tasks: ProposedTaskArgs[];
}

export interface UpdateTaskArgs {
  id: string;
  title?: string;
  goal?: string;
  criteria?: string[];
  notes?: string;
  dependsOn?: string[];
  milestone?: string;
}

export interface ProjectToolHandlers {
  context(scope: SkaroScope): Promise<ToolResult>;
  writeDoc(args: WriteDocArgs, scope: SkaroScope): Promise<ToolResult>;
  proposeAdr(args: ProposeAdrArgs, scope: SkaroScope): Promise<ToolResult>;
  proposeMilestones(args: ProposeMilestonesArgs, scope: SkaroScope): Promise<ToolResult>;
  proposeTasks(args: ProposeTasksArgs, scope: SkaroScope): Promise<ToolResult>;
  updateTask(args: UpdateTaskArgs, scope: SkaroScope): Promise<ToolResult>;
}

/** Wrong arguments: the agent reads the message and calls again. */
export class ToolArgsError extends Error {}

const TASK_SCHEMA = {
  type: 'object',
  properties: {
    ref: {
      type: 'string',
      description: 'Short key of the task in this call (t1, t2…), used in depends_on.',
    },
    title: { type: 'string', description: 'Short imperative title.' },
    goal: { type: 'string', description: 'What the task achieves and why, 1–3 sentences.' },
    criteria: {
      type: 'array',
      items: { type: 'string' },
      description: 'Acceptance criteria: checkable statements.',
    },
    notes: { type: 'string', description: 'Optional hints: files, decisions, constraints.' },
    depends_on: {
      type: 'array',
      items: { type: 'string' },
      description: 'Refs of tasks in this call or ids of existing tasks (T-004).',
    },
  },
  required: ['title', 'goal', 'criteria'],
  additionalProperties: false,
};

const inChat = (scope: SkaroScope): boolean => scope.kind === 'project_chat';

/** Parses the arguments first; bad arguments go back to the agent as a tool error. */
function guarded<A>(
  parse: (args: Record<string, unknown>) => A,
  call: (args: A, scope: SkaroScope) => Promise<ToolResult>,
): Tool<SkaroScope>['call'] {
  return async (args, scope) => {
    let parsed: A;
    try {
      parsed = parse(args);
    } catch (error) {
      if (error instanceof ToolArgsError) return { text: error.message, isError: true };
      throw error;
    }
    return call(parsed, scope);
  };
}

export function projectTools(handlers: ProjectToolHandlers): Tool<SkaroScope>[] {
  return [
    {
      name: 'get_project_context',
      description:
        'Read the project as Skaro keeps it: brief, architecture, ADRs, milestones and tasks with ' +
        'statuses and dependencies. Call it before proposing documents, milestones or tasks.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      call: (_args, scope) => handlers.context(scope),
    },
    {
      name: 'write_doc',
      description:
        'Write a whole project document: the brief (brief.md), the architecture ' +
        '(architecture.md, with a "Rules and constraints" section the coding agents must follow) ' +
        'or a free document (docs/<name>.md). Pass the complete new text, not a patch. The user ' +
        'sees the change as a card; depending on the project setting it is applied at once or ' +
        'after the user accepts it. The result tells you which.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'brief.md, architecture.md or docs/<name>.md (lowercase, dashes).',
          },
          content: { type: 'string', description: 'The full Markdown text of the document.' },
          summary: { type: 'string', description: 'One sentence: what changed and why.' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      available: inChat,
      call: guarded(
        (a) => ({
          path: text(a, 'path').replace(/^\.skaro\//, ''),
          content: text(a, 'content'),
          ...optional(a, 'summary'),
        }),
        (args, scope) => handlers.writeDoc(args, scope),
      ),
    },
    {
      name: 'propose_adr',
      description:
        'Propose an architecture decision record. The user accepts, edits or rejects it in a ' +
        'card; the tool returns at once, do not wait for the decision. Propose an ADR for ' +
        'decisions that are costly to change later.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The decision in a few words.' },
          context: { type: 'string', description: 'The problem and the forces at play.' },
          decision: { type: 'string', description: 'What is decided.' },
          consequences: { type: 'string', description: 'What follows, good and bad.' },
          replaces: { type: 'string', description: 'Id of an ADR this one replaces (0004).' },
          summary: { type: 'string', description: 'One or two sentences for the card.' },
        },
        required: ['title', 'context', 'decision', 'consequences'],
        additionalProperties: false,
      },
      available: inChat,
      call: guarded(
        (a) => ({
          title: text(a, 'title'),
          context: text(a, 'context'),
          decision: text(a, 'decision'),
          consequences: text(a, 'consequences'),
          ...optional(a, 'replaces'),
          ...optional(a, 'summary'),
        }),
        (args, scope) => handlers.proposeAdr(args, scope),
      ),
    },
    {
      name: 'propose_milestones',
      description:
        'Propose milestones, each with its tasks and their dependencies. Each milestone becomes a ' +
        'card where the user picks the tasks to create; the tool returns at once, do not wait for ' +
        'the decision. Tasks must be small enough for one agent run, with checkable criteria.',
      inputSchema: {
        type: 'object',
        properties: {
          milestones: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                goal: { type: 'string', description: 'What the milestone achieves.' },
                done_when: { type: 'string', description: 'When the milestone counts as done.' },
                tasks: { type: 'array', items: TASK_SCHEMA },
              },
              required: ['title', 'goal', 'done_when', 'tasks'],
              additionalProperties: false,
            },
          },
        },
        required: ['milestones'],
        additionalProperties: false,
      },
      available: inChat,
      call: guarded(
        (a) => {
          const milestones = list(a, 'milestones').map((m, i) => {
            const milestone = record(m, `milestones[${i}]`);
            return {
              title: text(milestone, 'title'),
              goal: text(milestone, 'goal'),
              doneWhen: text(milestone, 'done_when'),
              tasks: tasks(milestone, `m${i + 1}-`),
            };
          });
          uniqueRefs(milestones.flatMap((m) => m.tasks));
          return { milestones };
        },
        (args, scope) => handlers.proposeMilestones(args, scope),
      ),
    },
    {
      name: 'propose_tasks',
      description:
        'Propose tasks for an existing milestone (or without one). The user picks the tasks to ' +
        'create in a card; the tool returns at once, do not wait for the decision.',
      inputSchema: {
        type: 'object',
        properties: {
          milestone: { type: 'string', description: 'Id of an existing milestone (M02).' },
          tasks: { type: 'array', items: TASK_SCHEMA },
        },
        required: ['tasks'],
        additionalProperties: false,
      },
      available: inChat,
      call: guarded(
        (a) => {
          const list = tasks(a);
          uniqueRefs(list);
          return { ...optional(a, 'milestone'), tasks: list };
        },
        (args, scope) => handlers.proposeTasks(args, scope),
      ),
    },
    {
      name: 'update_task',
      description:
        'Propose changes to an existing task: title, goal, criteria, notes, dependencies or ' +
        'milestone. Pass only what changes; criteria replace the whole list. The user accepts or ' +
        'rejects the change in a card; the tool returns at once.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task id (T-012).' },
          title: { type: 'string' },
          goal: { type: 'string' },
          criteria: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
          depends_on: { type: 'array', items: { type: 'string' } },
          milestone: { type: 'string' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      available: inChat,
      call: guarded(
        (a) => ({
          id: text(a, 'id'),
          ...optional(a, 'title'),
          ...optional(a, 'goal'),
          ...optional(a, 'notes'),
          ...optional(a, 'milestone'),
          ...(a['criteria'] !== undefined ? { criteria: strings(a, 'criteria') } : {}),
          ...(a['depends_on'] !== undefined ? { dependsOn: strings(a, 'depends_on') } : {}),
        }),
        (args, scope) => handlers.updateTask(args, scope),
      ),
    },
  ];
}

function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ToolArgsError(`"${key}" is required and must be a non-empty string.`);
  }
  return value.trim();
}

function optional<K extends string>(
  args: Record<string, unknown>,
  key: K,
): Partial<Record<K, string>> {
  const value = args[key];
  return typeof value === 'string' && value.trim()
    ? ({ [key]: value.trim() } as Record<K, string>)
    : {};
}

function list(args: Record<string, unknown>, key: string): unknown[] {
  const value = args[key];
  if (!Array.isArray(value) || !value.length) {
    throw new ToolArgsError(`"${key}" must be a non-empty array.`);
  }
  return value;
}

function strings(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) throw new ToolArgsError(`"${key}" must be an array of strings.`);
  return value.map((v) => String(v).trim()).filter(Boolean);
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ToolArgsError(`${where} must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** Tasks without a ref get one; `prefix` keeps generated refs apart between milestones. */
function tasks(args: Record<string, unknown>, prefix = ''): ProposedTaskArgs[] {
  return list(args, 'tasks').map((t, i): ProposedTaskArgs => {
    const task = record(t, `tasks[${i}]`);
    const criteria = strings(task, 'criteria');
    if (!criteria.length) throw new ToolArgsError(`tasks[${i}]: "criteria" must not be empty.`);
    const ref = task['ref'];
    return {
      ref: typeof ref === 'string' && ref.trim() ? ref.trim() : `${prefix}task-${i + 1}`,
      title: text(task, 'title'),
      goal: text(task, 'goal'),
      criteria,
      ...optional(task, 'notes'),
      dependsOn: task['depends_on'] === undefined ? [] : strings(task, 'depends_on'),
    };
  });
}

/** Refs are how tasks of one call point at each other, so they must not repeat. */
function uniqueRefs(list: ProposedTaskArgs[]): void {
  const seen = new Set<string>();
  for (const task of list) {
    if (seen.has(task.ref)) {
      throw new ToolArgsError(`Task ref "${task.ref}" is used twice; give every task its own ref.`);
    }
    seen.add(task.ref);
  }
}
