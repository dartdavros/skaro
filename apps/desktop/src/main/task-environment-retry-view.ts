import type { AppDb, RunRecord } from '@skaro/core';
import type { TaskDetail } from '../shared/ipc';
import { TaskExecution } from './task-execution';

/** A settled environment recovery can be renewed by the existing Resume action. */
export function taskEnvironmentRetry(
  db: AppDb,
  task: TaskDetail,
  run: RunRecord | undefined,
  runtime: string | undefined,
): TaskDetail {
  if (
    !run ||
    task.archived ||
    task.stage !== 'in_progress' ||
    runtime === 'running' ||
    db.commands.hasPendingInput(`${run.projectId}:${run.taskId}`)
  )
    return task;
  const execution = new TaskExecution(db, run.id).read();
  return !execution.enabled && execution.blocked && execution.environmentBlocked
    ? { ...task, environmentRetry: true }
    : task;
}
