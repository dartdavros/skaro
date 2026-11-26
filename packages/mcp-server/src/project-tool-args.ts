import type { Tool, ToolResult } from './server.ts';
import type { SkaroScope } from './tools.ts';
import type { ProposedTaskArgs } from './project-tool-model.ts';

/** Wrong arguments: the agent reads the message and calls again. */
export class ToolArgsError extends Error {}

export const TASK_SCHEMA = {
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
      description:
        'Observable outcomes of the requested change. Put check methods and prerequisites in verification_notes.',
    },
    notes: { type: 'string', description: 'Optional hints: files, decisions, constraints.' },
    verification_notes: {
      type: 'string',
      description:
        'Optional verification methods for the affected outcomes, including their environment and prerequisites. These notes do not add acceptance criteria.',
    },
    requires_pull_request: {
      type: 'boolean',
      description:
        'Set true when delivering or verifying this task requires a pull request. Skaro provisions its task branch before execution.',
    },
    depends_on: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Refs of tasks in this call or earlier cards of this chat, or ids of existing tasks (T-004). Do not wait for task IDs; refs resolve when cards are accepted.',
    },
    spec: {
      type: 'string',
      description: 'Number of the specification the task implements (0003), if any.',
    },
  },
  required: ['title', 'goal', 'criteria'],
  additionalProperties: false,
};

export const inChat = (scope: SkaroScope): boolean =>
  scope.kind === 'project_chat' && !scope.importId;
export const inImport = (scope: SkaroScope): boolean =>
  scope.kind === 'project_chat' && !!scope.importId;

/** Parses the arguments first; bad arguments go back to the agent as a tool error. */
export function guarded<A>(
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

export function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ToolArgsError(`"${key}" is required and must be a non-empty string.`);
  }
  return value.trim();
}

export function optional<K extends string>(
  args: Record<string, unknown>,
  key: K,
): Partial<Record<K, string>> {
  const value = args[key];
  return typeof value === 'string' && value.trim()
    ? ({ [key]: value.trim() } as Record<K, string>)
    : {};
}

export function list(args: Record<string, unknown>, key: string, allowEmpty = false): unknown[] {
  const value = args[key];
  if (!Array.isArray(value) || (!allowEmpty && !value.length)) {
    throw new ToolArgsError(`"${key}" must be ${allowEmpty ? 'an array' : 'a non-empty array'}.`);
  }
  return value;
}

export function strings(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) throw new ToolArgsError(`"${key}" must be an array of strings.`);
  return value.map((v) => String(v).trim()).filter(Boolean);
}

export function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ToolArgsError(`${where} must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** Tasks without a ref get one; `prefix` keeps generated refs apart between milestones. */
export function tasks(
  args: Record<string, unknown>,
  prefix = '',
  allowEmpty = false,
): ProposedTaskArgs[] {
  return list(args, 'tasks', allowEmpty).map((t, i): ProposedTaskArgs => {
    const task = record(t, `tasks[${i}]`);
    if (
      !Array.isArray(task['criteria']) ||
      task['criteria'].some((item) => typeof item !== 'string' || /[\r\n]/.test(item))
    )
      throw new ToolArgsError(`tasks[${i}]: each criterion must be a single outcome statement.`);
    const criteria = strings(task, 'criteria');
    if (!criteria.length) throw new ToolArgsError(`tasks[${i}]: "criteria" must not be empty.`);
    const ref = task['ref'];
    const { verification_notes: verificationNotes } = optional(task, 'verification_notes');
    return {
      ref: typeof ref === 'string' && ref.trim() ? ref.trim() : `${prefix}task-${i + 1}`,
      title: text(task, 'title'),
      goal: text(task, 'goal'),
      criteria,
      ...(task['requires_pull_request'] === true && { requiresPullRequest: true }),
      ...optional(task, 'notes'),
      ...(verificationNotes && { verificationNotes }),
      dependsOn: task['depends_on'] === undefined ? [] : strings(task, 'depends_on'),
      ...optional(task, 'spec'),
    };
  });
}

/** Refs are how tasks of one call point at each other, so they must not repeat. */
export function uniqueRefs(list: ProposedTaskArgs[]): void {
  const seen = new Set<string>();
  for (const task of list) {
    if (seen.has(task.ref)) {
      throw new ToolArgsError(`Task ref "${task.ref}" is used twice; give every task its own ref.`);
    }
    seen.add(task.ref);
  }
}
