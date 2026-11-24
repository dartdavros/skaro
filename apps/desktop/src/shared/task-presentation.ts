import type { TaskStatus, TaskSummary } from './ipc-entities';
export type BoardStatus =
  | 'todo'
  | 'blocked'
  | 'working'
  | 'need'
  | 'paused'
  | 'stopped'
  | 'review'
  | 'done'
  | 'error'
  | 'cancelled';
export type TaskColumn = 'todo' | 'working' | 'review' | 'done';
export function boardStatus(status: TaskStatus): BoardStatus {
  if (status === 'in_progress' || status === 'queued') return 'working';
  if (status === 'needs_answer') return 'need';
  return status === 'failed' ? 'error' : status;
}
export function columnOf(task: Pick<TaskSummary, 'status' | 'stage'>): TaskColumn | undefined {
  switch (boardStatus(task.status)) {
    case 'cancelled':
      return undefined;
    case 'todo':
    case 'blocked':
      return 'todo';
    case 'error':
      return task.stage === 'review' ? 'review' : 'working';
    case 'review':
      return 'review';
    case 'done':
      return 'done';
    default:
      return 'working';
  }
}
export function activeKind(
  task: Pick<TaskSummary, 'status' | 'merge'>,
): 'need' | 'review' | 'working' | undefined {
  if (task.status === 'needs_answer') return 'need';
  if (task.status === 'review' && task.merge !== 'queued' && task.merge !== 'running')
    return 'review';
  if (task.status === 'in_progress' || task.status === 'queued') return 'working';
  return undefined;
}
export function needsYou(task: Pick<TaskSummary, 'status' | 'merge'>): boolean {
  const kind = activeKind(task);
  return kind === 'need' || kind === 'review';
}

export function taskMatches(task: TaskSummary, q: import('./task-catalog').TaskQuery): boolean {
  const text = q.query?.trim().toLowerCase();
  return (
    task.archived === !!q.archived &&
    (!q.milestones?.length || q.milestones.includes(task.milestone?.id ?? '')) &&
    (!q.statuses?.length || q.statuses.includes(boardStatus(task.status))) &&
    (!q.agents?.length || q.agents.includes(task.agent ?? 'none')) &&
    (q.spec === undefined || task.spec?.id === q.spec) &&
    (q.kind !== 'active' || !!activeKind(task)) &&
    (!q.column || (q.moved?.[task.id] ?? columnOf(task)) === q.column) &&
    (!text || `${task.id} ${task.title}`.toLowerCase().includes(text))
  );
}
