import type { AppDb, TaskRuntime } from '@skaro/core';
import type { TimelineState } from '@skaro/timeline';

/** Only a pending interaction needs an answer; machine recovery uses the existing queue state. */
export function taskTimelineRuntime(
  timeline: Pick<TimelineState, 'status' | 'interactions'>,
  recovering: boolean,
): TaskRuntime {
  if (timeline.interactions.some((interaction) => interaction.kind !== 'merge')) return 'waiting';
  if (timeline.status !== 'idle') return 'running';
  return recovering ? 'queued' : 'idle';
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
