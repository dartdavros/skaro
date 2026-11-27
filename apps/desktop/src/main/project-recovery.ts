import type { TaskRuns } from './tasks';
import type { ChatSessions } from './chats';
import type { C4Audits } from './c4-audits';
/** Never block the first frame on old histories; each domain retains its own journal and guards. */
export function startProjectRecovery(runs: TaskRuns, chats: ChatSessions, audits: C4Audits) {
  setImmediate(() => {
    void Promise.allSettled([
      runs.recoverTaskQueue(),
      chats.recoverReplans(),
      audits.recover(),
    ]).then((results) => {
      for (const result of results)
        if (result.status === 'rejected') console.error('Project recovery:', result.reason);
    });
  });
}
