import type { AppDb } from '@skaro/core';
import { taskLifecycleTools, type SkaroScope } from '@skaro/mcp-server';
import type { ChatSessions } from './chats';
import type { TaskBoard } from './task-board';

export function projectTaskLifecycleTools(
  db: AppDb,
  chats: () => ChatSessions,
  board: () => TaskBoard,
) {
  function assertChat(scope: SkaroScope) {
    const chat = scope.chatId ? db.getChat(scope.chatId) : undefined;
    if (
      scope.kind !== 'project_chat' ||
      scope.importId ||
      chat?.projectId !== scope.projectId ||
      chat.archived ||
      chat.taskId
    )
      throw new Error('An active project chat is required.');
    chats().assertMayWork(chat.id);
  }

  return taskLifecycleTools({
    delete: async (id, scope) => {
      assertChat(scope);
      await board().delete(scope.projectId, [id]);
      return { text: `Task ${id} was deleted.`, structuredContent: { taskId: id, deleted: true } };
    },
    setStatus: async (id, status, scope) => {
      assertChat(scope);
      await board().setStatus(scope.projectId, id, status);
      return {
        text: `Task ${id} has status ${status}.`,
        structuredContent: { taskId: id, status },
      };
    },
  });
}
