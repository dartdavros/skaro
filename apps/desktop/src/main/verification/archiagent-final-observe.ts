import assert from 'node:assert/strict';
import type { Services } from '../app-services';
import { inspectArchiagent } from './archiagent-inspect-live';

/** Retire only the failed chat created by this acceptance; never retry its uncertain delivery. */
export async function observeArchiagentFinal(s: Services, project: string, data: string) {
  const chatId = '2128db95-d3e9-4f75-ac84-fe16c3b880ac';
  const commandId = '1be6243f-4f97-4eb8-947d-b05f19fd1b55';
  const chat = s.db.getChat(chatId),
    command = s.db.commands.get(commandId);
  assert.equal(chat?.projectId, project);
  assert(command?.method === 'chat.send' && command.owner === `${project}:${chatId}`);
  assert(JSON.stringify(command.args).includes('Ограниченная реальная приёмка AG-1'));
  const before = command.state;
  await s.chats.interrupt(project, chatId);
  const after = s.db.commands.get(commandId)!;
  assert(['cancelled', 'delivered'].includes(after.state));
  const operation = s.db.coordination.getOperation(project, `owner-command:${commandId}`);
  assert(operation && ['failed', 'succeeded'].includes(operation.state));
  return {
    failedChatStop: { chatId, commandId, before, after: after.state, operation: operation.state },
    observationModelCalls: 0,
    inspection: await inspectArchiagent(s, project, data),
  };
}
