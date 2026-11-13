import type { AppDb, IncidentSubscription } from '@skaro/core';
import { TaskExecution } from './task-execution';
import { queueOwnerMessage } from './owner-commands';
/** Bounded synchronous commit; its callback is the existing durable owner inbox, never a native executor. */
export function commitIncidentDelivery(
  db: AppDb,
  projectId: string,
  incident: string,
  resource: string,
  subscription: IncidentSubscription,
  enqueue: typeof queueOwnerMessage = queueOwnerMessage,
) {
  const execution = new TaskExecution(db, subscription.runId);
  db.settings.atomic(() => {
    if (!execution.clearIncident(incident, subscription.intent)) return;
    enqueue('task.send', projectId, subscription.taskId, {
      internal: true,
      commandId: `continue-incident-${incident}-${subscription.runId}`,
      text: 'The recorded prerequisite was verified by Skaro. Recheck current task inputs and continue the existing authorized task; do not repeat the repair.',
    });
    db.addEvent(projectId, 'task_unblocked', { task: subscription.taskId, incident, resource });
  });
}
