import type { TaskDetail } from '../../../shared/ipc';

export function taskCanStop(
  task: Pick<TaskDetail, 'archived' | 'stage' | 'status' | 'lifecyclePending'>,
): boolean {
  if (task.archived || ['review', 'done', 'cancelled'].includes(task.stage)) return false;
  return (
    !!task.lifecyclePending ||
    task.status === 'queued' ||
    task.status === 'in_progress' ||
    task.stage === 'in_progress' ||
    task.stage === 'failed' ||
    task.stage === 'paused'
  );
}
