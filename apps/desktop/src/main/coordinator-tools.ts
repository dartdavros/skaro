import { taskBlockerTool, taskResumeTool } from '@skaro/mcp-server';
import type { SkaroScope, Tool } from '@skaro/mcp-server';
import type { ProjectMemory } from './project-memory';
import { projectMemoryTool } from './project-memory-tools';
import type { TaskRuns } from './tasks';
import type { ChatSessions } from './chats';
export function coordinatorTools(
  memory: ProjectMemory,
  runs: () => TaskRuns,
  chats: () => ChatSessions,
): Tool<SkaroScope>[] {
  return [
    projectMemoryTool(memory),
    taskBlockerTool((reason, scope, details) => runs().reportBlocker(reason, scope, details)),
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
          incidents: runs().incidents.store.list(scope.projectId),
          policy: runs().incidents.policy.read(scope.projectId),
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
