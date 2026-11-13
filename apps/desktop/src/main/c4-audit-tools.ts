import type { Tool, SkaroScope } from '@skaro/mcp-server';
import type { C4Audits } from './c4-audits';

/** Available only in a host-created audit chat; ordinary chats cannot assert an audit result. */
export function c4AuditTools(current: () => C4Audits): Tool<SkaroScope>[] {
  return [
    {
      name: 'finish_c4_audit',
      description:
        'Finish the explicit full architecture audit. Read all actual code and C4 documents first. Report partial when evidence is incomplete or questions remain. This does not accept or apply architecture packages. For material changes propose ONE normal C4 package, preserving current/planned and open questions. Never edit source files.',
      available: (scope) =>
        scope.kind === 'project_chat' &&
        !!scope.chatId &&
        !!current().store.forChat(scope.projectId, scope.chatId),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          outcome: { enum: ['unchanged', 'partial'] },
          summary: { type: 'string' },
          fingerprint: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: ['outcome', 'summary', 'fingerprint', 'evidence'],
      },
      call: async (args, scope) => {
        try {
          if (!scope.chatId) throw new Error('Audit chat required');
          return {
            text: JSON.stringify(await current().finish(scope.projectId, scope.chatId, args)),
          };
        } catch (error) {
          return { text: String(error), isError: true };
        }
      },
    },
  ];
}
