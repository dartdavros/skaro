import type { AppDb, TaskRuntime } from '@skaro/core';
import type { TimelineState } from '@skaro/timeline';
import { isBlockingTaskProposal, type TaskC4WaitPolicy } from '../shared/feed-actions';

/** Owner questions, active work and resource waits retain their distinct existing statuses. */
export function taskTimelineRuntime(
  timeline: Pick<TimelineState, 'status' | 'interactions'> & Partial<Pick<TimelineState, 'items'>>,
  recovery: 'queued' | 'running' | undefined,
  blocksC4?: TaskC4WaitPolicy,
): TaskRuntime {
  if (timeline.interactions.some((interaction) => interaction.kind !== 'merge')) return 'waiting';
  if (timeline.items?.some((item) => isBlockingTaskProposal(item, blocksC4))) return 'waiting';
  if (timeline.status !== 'idle') return 'running';
  return recovery ?? 'idle';
}

/** The database represents idle by deleting the row, including its run identity. */
export function sameTaskRuntime(
  current: { state: TaskRuntime; runId?: string } | undefined,
  state: TaskRuntime,
  runId?: string,
): boolean {
  if (state === 'idle') return current === undefined;
  return current?.state === state && current.runId === runId;
}

/** Return whether callers must publish a runtime change; repeated reads stay silent. */
export function updateTaskRuntime(
  db: Pick<AppDb, 'getTaskRuntime' | 'setTaskRuntime'>,
  projectId: string,
  taskId: string,
  state: TaskRuntime,
  runId?: string,
): boolean {
  if (sameTaskRuntime(db.getTaskRuntime(projectId).get(taskId), state, runId)) return false;
  db.setTaskRuntime(projectId, taskId, state, runId);
  return true;
}
