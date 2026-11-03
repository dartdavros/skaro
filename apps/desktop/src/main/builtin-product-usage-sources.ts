import { parseModelUsageSources as parse } from '@skaro/agent-runtime';
import type { AppDb } from '@skaro/core';
import type { BuiltinSessionPreparation } from './builtin-session-models';

const key = (projectId: string) => `builtin.usage.${projectId}.sources`;
export const productUsageSources = (db: AppDb, projectId: string) =>
  parse(db.getSetting(key(projectId), []));

/** Register a real pending intent before dispatch; clearing UI history cannot reset project billing. */
export function registerProductUsage(db: AppDb, input: BuiltinSessionPreparation) {
  const kind = input.scope.kind === 'task' ? 'tasks' : 'chats';
  const id = input.scope.kind === 'task' ? input.scope.runId : input.scope.chatId;
  const [entry] = parse([{ kind, id, sessionId: input.sessionId }]);
  const previous = productUsageSources(db, input.scope.projectId);
  if (
    previous.some(
      (item) => item.kind === kind && item.id === id && item.sessionId === input.sessionId,
    )
  )
    return;
  db.setSetting(key(input.scope.projectId), [...previous, entry]);
}
