import { taskBlockerTool, taskResumeTool, questionCancelTool } from '@skaro/mcp-server';
import type { SkaroScope, Tool } from '@skaro/mcp-server';
import type { ProjectMemory } from './project-memory';
import { projectMemoryTool } from './project-memory-tools';
import type { TaskRuns } from './tasks';
import type { ChatSessions } from './chats';
import { ownerQuestionTool } from './owner-question-tool';
export function coordinatorTools(
  memory: ProjectMemory,
  runs: () => TaskRuns,
  chats: () => ChatSessions,
): Tool<SkaroScope>[] {
  return [
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
  ];
}
