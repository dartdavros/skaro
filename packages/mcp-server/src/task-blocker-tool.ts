import type { Tool, ToolResult } from './server.ts';
import type { SkaroScope } from './tools.ts';
import { INCIDENT_CAUSES, type IncidentCause, type IncidentProtocol } from '@skaro/core';
export interface TaskBlockerDetails {
  cause: IncidentCause;
  code: string;
  resourceId?: string;
  condition?: IncidentProtocol['condition'];
}

/** A real external blocker is a durable execution state, not an empty question. */
export function taskBlockerTool(
  handler: (reason: string, scope: SkaroScope, details?: TaskBlockerDetails) => Promise<ToolResult>,
): Tool<SkaroScope> {
  return {
    name: 'report_task_blocker',
    description:
      'Stop automatic task continuation only for an evidenced external blocker or an explicit owner pause. ' +
      'Include the exact failed prerequisite, diagnostic code, registered resource_id when known, and condition. ' +
      'Skaro coordinates a bounded repair once under project permissions, then verifies it before resuming subscribers. ' +
      'Do not repeatedly repair a shared resource or poll the model while blocked. This does not accept criteria, ' +
      'complete or merge the task. Missing owner decisions use the blocking question tool instead. ' +
      'Missing owner API keys/passwords use request_secret; its protected question is the waiting state. ' +
      'Ordinary chat follow-ups already suspend automatic continuation; answer a question and end ' +
      'the turn without inventing a task blocker. An explicit owner pause may be recorded here.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', minLength: 1 },
        cause: { type: 'string', enum: INCIDENT_CAUSES },
        code: { type: 'string', pattern: '^[a-z0-9_-]+$' },
        resource_id: { type: 'string' },
        condition: {
          type: 'string',
          enum: ['environment-ready', 'inputs-current', 'provider-evidence', 'owner-evidence'],
        },
      },
      required: ['reason'],
      additionalProperties: false,
    },
    available: (scope) => scope.kind === 'task' && !!scope.taskId,
    call: async (args, scope) => {
      if (
        scope.kind !== 'task' ||
        !scope.taskId ||
        typeof args['reason'] !== 'string' ||
        !args['reason'].trim()
      )
        return {
          text: 'A current task and an evidenced blocker reason are required.',
          isError: true,
        };
      if (
        (args['cause'] === undefined &&
          ['code', 'resource_id', 'condition'].some((k) => args[k] !== undefined)) ||
        (args['resource_id'] !== undefined &&
          (typeof args['resource_id'] !== 'string' || !args['resource_id'].trim())) ||
        (args['condition'] !== undefined &&
          !['environment-ready', 'inputs-current', 'provider-evidence', 'owner-evidence'].includes(
            String(args['condition']),
          )) ||
        (args['cause'] !== undefined &&
          (!INCIDENT_CAUSES.includes(args['cause'] as IncidentCause) ||
            typeof args['code'] !== 'string' ||
            !/^[a-z0-9_-]{1,80}$/.test(args['code'])))
      )
        return {
          text: 'Structured blocker requires a known cause and stable diagnostic code.',
          isError: true,
        };
      return handler(
        args['reason'].trim(),
        scope,
        args['cause'] === undefined
          ? undefined
          : {
              cause: args['cause'] as IncidentCause,
              code: args['code'] as string,
              ...(typeof args['resource_id'] === 'string'
                ? { resourceId: args['resource_id'] }
                : {}),
              ...(typeof args['condition'] === 'string'
                ? { condition: args['condition'] as IncidentProtocol['condition'] }
                : {}),
            },
      );
    },
  };
}
