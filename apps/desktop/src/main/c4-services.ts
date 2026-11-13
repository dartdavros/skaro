import type { AppDb } from '@skaro/core';
import type { EventName, Events } from '../shared/ipc';
import type { Projects } from './projects';
import type { ChatSessions } from './chats';
import type { TaskRuns } from './tasks';
import { C4Service } from './c4-service';
import { C4Audits } from './c4-audits';
import { CiRuns } from './ci-runs';

export function createC4Services(
  db: AppDb,
  projects: Projects,
  chats: ChatSessions,
  runs: TaskRuns,
  emit: <E extends EventName>(name: E, value: Events[E]) => void,
  locale: () => string,
  notify: (text: string) => void,
) {
  const c4 = new C4Service({
    assertMayWork: (scope) => {
      if (scope.chatId) chats.assertMayWork(scope.chatId);
    },
    db,
    projects,
    locale,
    publish: (scope, item) =>
      scope.kind === 'task'
        ? runs.architectureEvent(scope, item)
        : chats.architectureEvent(scope, item),
    changed: (projectId) => emit('project.changed', { projectId }),
    stageImport: (args, scope) => chats.stageC4(args, scope),
  });
  const c4Audits = new C4Audits(db, projects, chats, c4, emit);
  const ci = new CiRuns(db, projects, async (scope, text, error) => {
    if (scope.kind === 'task' && scope.taskId)
      await runs.operationNotice(scope.projectId, scope.taskId, text, error);
    else if (scope.chatId) await chats.operationNotice(scope.projectId, scope.chatId, text, error);
    if (error) notify(text);
  });
  return { c4, c4Audits, ci };
}
