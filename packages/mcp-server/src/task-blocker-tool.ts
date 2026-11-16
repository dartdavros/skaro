import type { Tool, ToolResult } from './server.ts';
import type { SkaroScope } from './tools.ts';
import type { ToolCallContext } from './tool-call-identity.ts';
import { INCIDENT_CAUSES, type IncidentCause, type IncidentProtocol } from '@skaro/core';
import { isIncidentOwnerPause } from './incident-owner-pause.ts';
export interface TaskBlockerDetails {
  cause: IncidentCause;
  code: string;
  resourceId?: string;
  condition?: IncidentProtocol['condition'];
}

/** A real external blocker is a durable execution state, not an empty question. */
export function taskBlockerTool(
  handler: (
    reason: string,
    scope: SkaroScope,
    details?: TaskBlockerDetails,
    context?: ToolCallContext,
  ) => Promise<ToolResult>,
): Tool<SkaroScope> {
  return {
    name: 'report_task_blocker',
    description:
      'Stop automatic task continuation only for an evidenced external blocker or an explicit owner pause. ' +
      'Include the exact failed prerequisite, diagnostic code, registered resource_id when known, and condition. ' +
      'Skaro coordinates a bounded repair once under project permissions, then verifies it before resuming subscribers. ' +
      'Do not repeatedly repair a shared resource or poll the model while blocked. This does not accept criteria, ' +
      'complete or merge the task. Missing owner decisions use the blocking question tool instead. ' +
      'If a known recovery action only lacks owner permission (including shared-service updates/restarts), ' +
      'immediately request the exact action and its consequences in that card and wait. ' +
      'This tool rejects missing permission without recording a blocker. ' +
      'Missing owner API keys/passwords use request_secret; its protected question is the waiting state. ' +
      'Claim registration only after a successful recorded acknowledgement. A queued or uncertain ' +
      'operation is not a recorded blocker; inspect the actual project incident state instead of ' +
      'inventing confirmation or blindly repeating an unknown effect. ' +
      'Ordinary chat follow-ups already suspend automatic continuation; answer a question and end ' +
      'the turn without inventing a task blocker. An explicit owner pause uses cause="owner-decision" ' +
      'and code="owner_pause"; it disables execution intent and never starts model diagnosis.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', minLength: 1 },
        requires_owner_permission: {
          type: 'boolean',
          description:
            'Does the known next action require owner consent that has not been granted? ' +
            'If true, use the structured question tool instead. Set false only for an external ' +
            'prerequisite failure that permission cannot resolve, or an explicit owner pause.',
        },
        cause: { type: 'string', enum: INCIDENT_CAUSES },
        code: { type: 'string', pattern: '^[a-z0-9_-]+$' },
        resource_id: { type: 'string' },
        condition: {
          type: 'string',
          enum: ['environment-ready', 'inputs-current', 'provider-evidence', 'owner-evidence'],
        },
      },
      required: ['reason', 'requires_owner_permission'],
      additionalProperties: false,
    },
    available: (scope) => scope.kind === 'task' && !!scope.taskId,
    call: async (args, scope, context) => {
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
      if (args['requires_owner_permission'] !== false)
        return {
          text:
            'No blocker was recorded. If the known next action requires owner permission, ' +
            'immediately invoke the structured question tool with the exact action, affected ' +
            'services/data, consequences and concrete allow/decline options, then wait. ' +
            'Do not ask the owner to invent a resolution or finish with a blocker summary. ' +
            'For an actual external prerequisite failure or explicit owner pause, confirm ' +
            'requires_owner_permission=false before reporting it.',
          isError: true,
          structuredContent: {
            failure: {
              category:
                args['requires_owner_permission'] === true
                  ? 'owner_permission_required'
                  : 'blocker_resolution_required',
              blockerRecorded: false,
            },
          },
        };
      if (
        ['owner-decision', 'permission', 'secret'].includes(String(args['cause'])) &&
        !isIncidentOwnerPause(String(args['cause']), String(args['code']))
      )
        return {
          text: 'No blocker was recorded. Use the structured question tool for a missing owner decision or permission, with concrete options and consequences. Use request_secret for protected inputs.',
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
        context,
      );
    },
  };
}
