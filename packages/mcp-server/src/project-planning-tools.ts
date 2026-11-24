import type { Tool } from './server.ts';
import type { SkaroScope } from './tools.ts';
import { TASK_DECOMPOSITION_RULES } from './task-decomposition.ts';
import type {
  ControlPlanArgs,
  PreparePlanArgs,
  ProjectPlanningHandlers,
} from './project-planning-model.ts';
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

export function parsePreparedPlan(args: Record<string, unknown>): PreparePlanArgs {
  const key = text(args, 'key');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key)) {
    throw new ToolArgsError('key must contain 1–64 letters, digits, underscores or hyphens.');
  }
  const expectedTotal = args['expected_total'];
  if (!Number.isSafeInteger(expectedTotal) || Number(expectedTotal) < 1) {
    throw new ToolArgsError('expected_total must be a positive integer.');
  }
  const milestones = list(args, 'milestones').map((value) => {
    const group = record(value, 'milestones[]');
    const raw = list(group, 'tasks');
    raw.forEach((t) => text(record(t, 'tasks[]'), 'ref'));
    return {
      milestone: text(group, 'milestone').toUpperCase(),
      requirements: strings(group, 'requirements'),
      tasks: tasks(group).map((task, i) => ({
        ...task,
        requirements: strings(record(raw[i], 'tasks[]'), 'requirements'),
      })),
    };
  });
  uniqueRefs(milestones.flatMap((m) => m.tasks));
  if (milestones.flatMap((m) => m.tasks).length !== expectedTotal) {
    throw new ToolArgsError('expected_total differs from the number of complete task records.');
  }
  if (new Set(milestones.map((m) => m.milestone)).size !== milestones.length) {
    throw new ToolArgsError('Each milestone must appear once.');
  }
  return { key, title: text(args, 'title'), expectedTotal: Number(expectedTotal), milestones };
}

const keySchema = { key: { type: 'string', description: 'Stable key returned by prepare_plan.' } };
const keyArgs = (args: Record<string, unknown>) => ({ key: text(args, 'key') });

export function planningTools(handlers: ProjectPlanningHandlers): Tool<SkaroScope>[] {
  const result: Tool<SkaroScope>[] = [
    ...(handlers.beginTaskPlan
      ? [
          {
            name: 'begin_task_plan',
            description:
              'Register planning only when the owner requests Skaro tasks or agrees to delegate work into tasks. A text plan or work completed directly in project chat requires no task plan. If a required C4 or milestone proposal is pending, call again with its exact decision_id to resume after application.',
            inputSchema: {
              type: 'object',
              properties: { decision_id: { type: 'string' } },
              additionalProperties: false,
            },
            available: inChat,
            call: guarded(
              (args) => optional(args, 'decision_id'),
              (args, scope) => handlers.beginTaskPlan!(args.decision_id, scope),
            ),
          } satisfies Tool<SkaroScope>,
        ]
      : []),
    {
      name: 'prepare_plan',
      description:
        'Save the COMPLETE task decomposition before showing task cards. Include all target ' +
        'existing milestones, full task records, requirement coverage and dependencies by unique ' +
        'ref, including dependencies across milestones. expected_total must match the records. ' +
        'This saves a draft, not task files. Repeating the same key and contents is idempotent. ' +
        'Skaro offers the saved plan automatically when ready. Never claim tasks are prepared before this succeeds.\n\nTask boundaries:\n' +
        TASK_DECOMPOSITION_RULES,
      inputSchema: {
        type: 'object',
        properties: {
          ...keySchema,
          title: { type: 'string' },
          expected_total: { type: 'integer', minimum: 1 },
          milestones: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                milestone: { type: 'string', description: 'Existing milestone, e.g. M08.' },
                requirements: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'All requirements in scope, e.g. SPEC-0001:R-1; [] for a small fix.',
                },
                tasks: {
                  type: 'array',
                  minItems: 1,
                  items: {
                    ...TASK_SCHEMA,
                    properties: {
                      ...TASK_SCHEMA.properties,
                      requirements: { type: 'array', items: { type: 'string' } },
                    },
                    required: [...TASK_SCHEMA.required, 'ref', 'requirements'],
                  },
                },
              },
              required: ['milestone', 'requirements', 'tasks'],
              additionalProperties: false,
            },
          },
        },
        required: ['key', 'title', 'expected_total', 'milestones'],
        additionalProperties: false,
      },
      available: inChat,
      call: guarded(parsePreparedPlan, (args, scope) => handlers.preparePlan(args, scope)),
    },
    {
      name: 'propose_saved_plan',
      description:
        'Present the entire saved task graph as ONE plan with ONE confirmation. No per-milestone ' +
        'approval or T-xxx numbers are needed. The legacy milestone argument does not split the plan. ' +
        'Repeated calls do not duplicate the review. All linked specs must be accepted before presenting the plan.',
      inputSchema: {
        type: 'object',
        properties: { ...keySchema, milestone: { type: 'string' } },
        required: ['key'],
        additionalProperties: false,
      },
      available: inChat,
      call: guarded(
        (args) => ({ ...keyArgs(args), ...optional(args, 'milestone') }),
        (args, scope) => handlers.proposeSavedPlan(args, scope),
      ),
    },
    {
      name: 'finish_plan',
      description:
        'Verify that every saved task was proposed and that milestones, requirements and ' +
        'dependencies are covered. Returns an error with the remaining work if incomplete. ' +
        'Finishing proposals does not mean the user accepted or created all tasks.',
      inputSchema: {
        type: 'object',
        properties: keySchema,
        required: ['key'],
        additionalProperties: false,
      },
      available: inChat,
      call: guarded(keyArgs, (args, scope) => handlers.finishPlan(args, scope)),
    },
    {
      name: 'control_plan',
      description:
        'Pause with a concrete blocker or missing owner decision; resume when resolved. ' +
        'Cancel ONLY when the owner explicitly cancels this planning request. Never pause ' +
        'merely because a batch was shown or task numbers do not exist. Does not delete cards or tasks.',
      inputSchema: {
        type: 'object',
        properties: {
          ...keySchema,
          action: { type: 'string', enum: ['pause', 'resume', 'cancel'] },
          reason: { type: 'string' },
        },
        required: ['key', 'action', 'reason'],
        additionalProperties: false,
      },
      available: inChat,
      call: guarded(
        (args): ControlPlanArgs => {
          const action = text(args, 'action');
          if (action !== 'pause' && action !== 'resume' && action !== 'cancel') {
            throw new ToolArgsError('action must be pause, resume or cancel.');
          }
          return { ...keyArgs(args), action, reason: text(args, 'reason') };
        },
        (args, scope) => handlers.controlPlan(args, scope),
      ),
    },
  ];
  if (handlers.revisePlan) {
    const index = result.findIndex((tool) => tool.name === 'prepare_plan');
    const prepare = result[index]!;
    result.splice(index + 1, 0, {
      ...prepare,
      name: 'revise_plan',
      description:
        'Revise an existing saved draft after the owner requests a correction, including removing uncreated tasks and fixing dependencies. Supply the SAME key, reason and COMPLETE replacement decomposition. Only unaccepted drafts can change. The prior review is superseded and a fresh complete card requires owner confirmation; no task files change. Use delete_tasks/replan_tasks for already created tasks. Never bypass a refusal through computer control or shell.',
      inputSchema: {
        ...prepare.inputSchema,
        properties: {
          ...(prepare.inputSchema.properties as Record<string, unknown>),
          reason: { type: 'string', minLength: 1 },
        },
        required: [...(prepare.inputSchema.required as string[]), 'reason'],
      },
      call: guarded(
        (args) => ({ ...parsePreparedPlan(args), reason: text(args, 'reason') }),
        (args, scope) => handlers.revisePlan!(args, scope),
      ),
    });
  }
  return result;
}
