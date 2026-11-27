import { taskBlockerTool, taskResumeTool, questionCancelTool } from '@skaro/mcp-server';
import type { SkaroScope, Tool } from '@skaro/mcp-server';
import type { ProjectMemory } from './project-memory';
import { projectMemoryTool } from './project-memory-tools';
import type { TaskRuns } from './tasks';
import type { ChatSessions } from './chats';
import { incidentModelTools } from './incident-model-tools';
import { TaskExecution } from './task-execution';
import { incidentModelPlan } from './incident-model-plan';
import { pendingTransitions } from './task-lifecycle-journal';
import { ownerQuestionTool } from './owner-question-tool';
export function coordinatorTools(
  memory: ProjectMemory,
  runs: () => TaskRuns,
  chats: () => ChatSessions,
): Tool<SkaroScope>[] {
  return [
    ...incidentModelTools(runs, chats),
    ownerQuestionTool((scope, question) =>
      scope.kind === 'task' ? runs().askOwner(scope, question) : chats().askOwner(scope, question),
    ),
    questionCancelTool(async (id, reason, scope) => {
      if (scope.kind === 'integration') await runs().cancelIntegrationQuestion(id, reason, scope);
      else if (scope.kind === 'task' && scope.taskId && scope.runId)
        await runs().cancelQuestion(scope.projectId, scope.taskId, id, reason, scope.runId);
      else if (scope.kind === 'project_chat' && scope.chatId)
        await chats().cancelQuestion(scope.projectId, scope.chatId, id, reason);
      else
        return { text: 'Question cancellation requires its current conversation.', isError: true };
      return {
        text: 'The question card was cancelled. No fields were answered and no permission was granted.',
      };
    }),
    projectMemoryTool(memory),
    taskBlockerTool((reason, scope, details, context) =>
      runs().reportBlocker(reason, scope, details, context?.id),
    ),
    taskResumeTool((commandId, instruction, scope) =>
      runs().resumeTask(commandId, instruction, scope),
    ),
    {
      name: 'read_project_incidents',
      description:
        'Read project incidents, evidence references, current action policy and subscriber versions. Historical records grant no new permission.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      call: async (_args, scope) => ({
        text: JSON.stringify({
          unconfirmedMerges: runs()
            .incidents.store.db.coordination.pending(scope.projectId)
            .filter(
              (op) =>
                op.state === 'uncertain' &&
                op.action === 'mcp.merge_task' &&
                op.subject.kind === 'task',
            )
            .map((op) => ({ operationId: op.id, task: op.subject.id })),
          lifecycleRequests: pendingTransitions(runs().incidents.store.db, scope.projectId).map(
            (entry) => ({
              task: entry.id,
              target: entry.target,
              run: entry.run,
              phase: entry.phase,
              incident: entry.incidentId,
              recovery:
                'Use verify_project_incident with the recorded incident ID to reconcile the lifecycle request. Continue work on other tasks.',
            }),
          ),
          incidents: runs()
            .incidents.store.list(scope.projectId)
            .map((row) => ({
              ...row,
              diagnosis: incidentModelPlan(runs().incidents.store.db, row),
              failures: row.protocol!.subscriptions.map((s) => ({
                task: s.taskId,
                run: s.runId,
                reason: new TaskExecution(runs().incidents.store.db, s.runId).read().blocked,
              })),
            })),
          policy: runs().incidents.policy.read(scope.projectId),
          environments: runs()
            .incidents.store.db.resources.list(scope.projectId)
            .filter((r) => r.kind === 'environment' && r.ownership === 'registered')
            .map((r) => ({ id: r.id, owner: r.owner, state: r.state })),
        }),
      }),
    },
    {
      name: 'decide_project_incident',
      description:
        'In delegated mode only, evaluate an exact incident remedy inside the owner policy. Cannot change policies, budgets, providers, credentials or worker sandbox.',
      available: (s) => s.kind === 'project_chat' && !!s.chatId,
      inputSchema: {
        type: 'object',
        properties: {
          incident_id: { type: 'string' },
          allow: { type: 'boolean' },
          reason: { type: 'string' },
          expires_at: { type: 'integer' },
        },
        required: ['incident_id', 'allow', 'reason', 'expires_at'],
        additionalProperties: false,
      },
      call: async (args, scope) => {
        if (
          scope.kind !== 'project_chat' ||
          !scope.chatId ||
          typeof args.incident_id !== 'string' ||
          typeof args.allow !== 'boolean' ||
          typeof args.reason !== 'string' ||
          typeof args.expires_at !== 'number'
        )
          throw new Error('Invalid delegated coordinator request');
        chats().assertMayWork(scope.chatId);
        await runs().incidents.decisions.delegate(
          scope.projectId,
          args.incident_id,
          args.allow,
          args.reason,
          args.expires_at,
        );
        return { text: 'The delegated decision was checked against the current owner policy.' };
      },
    },
  ];
}
