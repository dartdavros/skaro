import type { AppDb } from '@skaro/core';
import type { TaskSummary } from '../shared/ipc';
import { resourcesFor } from './resource-execution';

export const ownerResourceWait = (db: AppDb, projectId: string, ownerId: string) =>
  resourcesFor(db)?.manager.waiting(projectId, ownerId);

export function taskResourceWait<T extends TaskSummary>(db: AppDb, projectId: string, task: T): T {
  if (task.archived || ['done', 'cancelled', 'paused', 'stopped'].includes(task.stage)) return task;
  const resourceWait = ownerResourceWait(db, projectId, `task:${task.id}`);
  return resourceWait
    ? { ...task, status: task.status === 'needs_answer' ? task.status : 'queued', resourceWait }
    : task;
}
