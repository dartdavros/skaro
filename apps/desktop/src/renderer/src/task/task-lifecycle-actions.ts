import type { TaskDetail } from '../../../shared/ipc';

export type TaskLifecycleAction = 'start' | 'pause' | 'stop' | 'resume';

export function taskLifecycleActions(
  task: Pick<TaskDetail, 'archived' | 'stage' | 'status' | 'lifecyclePending'>,
): readonly TaskLifecycleAction[] {
  if (task.archived || ['review', 'done', 'cancelled'].includes(task.stage)) return [];
  if (task.lifecyclePending) return ['stop'];
  if (task.status === 'queued' || task.status === 'in_progress') return ['pause', 'stop'];
  switch (task.stage) {
    case 'paused':
      return ['resume', 'stop'];
    case 'stopped':
      return ['resume'];
    case 'in_progress':
    case 'failed':
      return ['pause', 'stop'];
    default:
      return ['start'];
  }
}
