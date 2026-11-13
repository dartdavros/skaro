import type { TaskRuns } from './tasks';
import type { ChatSessions } from './chats';
import type { C4Audits } from './c4-audits';
/** Never block the first frame on old histories; each domain retains its own journal and guards. */
export function startProjectRecovery(runs: TaskRuns, chats: ChatSessions, audits: C4Audits) {
  setImmediate(() => {
    void audits
      .recover()
      .then(() => Promise.allSettled([runs.recoverCoordination(), chats.recoverReplans()]))
      .then((results) => {
        for (const result of results)
          if (result.status === 'rejected') console.error('Project recovery:', result.reason);
      })
      .catch((error) => console.error('C4 recovery:', error));
  });
}
