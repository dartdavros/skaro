import { incidentHash } from '@skaro/core';
import type { SkaroScope, Tool } from '@skaro/mcp-server';
import type { TaskRuns } from './tasks';
import type { ChatSessions } from './chats';
import { incidentPlanKey, parseIncidentOptions } from './incident-model-plan';

/** Model reasoning is data; verification and continuation remain controller operations. */
export function incidentModelTools(
  runs: () => TaskRuns,
  chats: () => ChatSessions,
): Tool<SkaroScope>[] {
  const properties = { incident_id: { type: 'string', minLength: 1 } };
  return [
    {
      name: 'plan_project_incident',
      description:
        'Diagnose a current project incident. Supply actionable owner options with consequences. ' +
        'For an already authorized repair, set requires_owner_decision=false and bind an existing configured ' +
        'project check by name. This grants no new permission and does not resolve or resume the task.',
      available: (s) => s.kind === 'project_chat' || s.kind === 'task',
      inputSchema: {
        type: 'object',
        properties: {
          ...properties,
          explanation: { type: 'string', minLength: 1 },
          question: { type: 'string' },
          requires_owner_decision: { type: 'boolean' },
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 3,
            items: {
              type: 'object',
              properties: { label: { type: 'string' }, description: { type: 'string' } },
              required: ['label', 'description'],
              additionalProperties: false,
            },
          },
          verification_check: { type: 'string' },
          verification_environment: {
            type: 'string',
            description:
              'Registered environment resource ID of the current task; readiness is checked by Skaro.',
          },
        },
        required: ['incident_id', 'explanation', 'requires_owner_decision'],
        additionalProperties: false,
      },
      call: async (args, scope) => {
        if (scope.kind === 'project_chat' && scope.chatId) chats().assertMayWork(scope.chatId);
        if (
          typeof args.incident_id !== 'string' ||
          typeof args.explanation !== 'string' ||
          !args.explanation.trim() ||
          args.explanation.length > 8000 ||
          typeof args.requires_owner_decision !== 'boolean'
        )
          throw new Error('A concrete diagnosis and decision requirement are required');
        const controller = runs();
        const row = await controller.prepareIncident(scope, args.incident_id);
        const options = args.requires_owner_decision ? parseIncidentOptions(args.options) : [];
        if (
          args.requires_owner_decision &&
          (typeof args.question !== 'string' || !args.question.trim())
        )
          throw new Error('Provide the smallest actionable resolution question');
        const checks = (await controller.incidentArtifacts(scope.projectId)).config.checks;
        const check =
          typeof args.verification_check === 'string'
            ? checks.find((c) => c.name === args.verification_check)
            : undefined;
        if (args.verification_check !== undefined && !check)
          throw new Error('Only an existing configured project check may verify repair');
        const environment =
          typeof args.verification_environment === 'string'
            ? await controller.incidents.bindEnvironment(row, args.verification_environment)
            : undefined;
        if (
          !args.requires_owner_decision &&
          row.protocol!.condition === 'owner-evidence' &&
          !check &&
          !environment
        )
          throw new Error('Bind a configured verification check or offer concrete owner options');
        const fresh = await controller.prepareIncident(scope, row.id);
        if (fresh.revision !== row.revision) throw new Error('Incident changed during diagnosis');
        controller.incidents.store.db.setSetting(incidentPlanKey(row.id), {
          explanation: args.explanation.trim(),
          question: args.question ?? '',
          options,
          ...(check ? { verification: check } : {}),
          ...(environment ? { verificationEnvironment: environment } : {}),
          resourceVersion: row.protocol!.resourceVersion,
          policyRevision: row.protocol!.ownerPolicyRevision,
          subscriptions: incidentHash(row.protocol!.subscriptions),
        });
        controller.incidents.store.db.addEvent(scope.projectId, 'incident_model_diagnosed', {
          incident: row.id,
          options: options.length,
          verification: check ? incidentHash(check) : undefined,
        });
        if (args.requires_owner_decision) await controller.incidents.escalate(row);
        return {
          text: args.requires_owner_decision
            ? 'The diagnosed resolution question is open above the composer. Wait for its answer.'
            : 'The verification condition is bound. Perform only the authorized repair, then call verify_project_incident.',
        };
      },
    },
    {
      name: 'verify_project_incident',
      description:
        'Verify the actual recorded incident condition after repair using Skaro services or the bound configured check. ' +
        'Only a successful current check resolves the blocker and resumes authorized subscribers. Model prose is never proof.',
      available: (s) => s.kind === 'project_chat' || s.kind === 'task',
      inputSchema: {
        type: 'object',
        properties,
        required: ['incident_id'],
        additionalProperties: false,
      },
      call: async (args, scope) => {
        if (scope.kind === 'project_chat' && scope.chatId) chats().assertMayWork(scope.chatId);
        if (typeof args.incident_id !== 'string') throw new Error('An incident ID is required');
        await runs().verifyIncident(scope, args.incident_id);
        return {
          text: 'The recorded condition was verified by Skaro. The incident is resolved; eligible subscribers continue once.',
        };
      },
    },
  ];
}
