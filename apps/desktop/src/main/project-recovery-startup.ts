import type { OwnerCommands } from './owner-commands';
import type { TaskRuns } from './tasks';
import type { ChatSessions } from './chats';
import type { C4Audits } from './c4-audits';
import { startProjectRecovery } from './project-recovery';

/** C4 migration/application is a startup writer barrier, not a concurrent background producer. */
export async function startProjectWriters(
  commands: OwnerCommands,
  runs: TaskRuns,
  chats: ChatSessions,
  audits: C4Audits,
) {
  commands.start(
    {
      'chat.send': (projectId, chatId, input) => chats.send(projectId, chatId, input),
      'task.send': (projectId, taskId, input) => runs.send(projectId, taskId, input),
    },
    true,
  );
  await audits.recover();
  commands.activate();
  startProjectRecovery(runs, chats, audits);
}
