import type { AppDb, RunRecord } from '@skaro/core';
import type { TaskDetail } from '../shared/ipc';
import { SETTLED_ENVIRONMENT_FAILURE } from './environment-remedy-receipt';
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
  const id = new TaskExecution(db, run.id).read().blockedIncident;
  const row = id && db.coordination.blockers.get(run.projectId, id);
  if (!row || row.state !== 'open' || row.protocol?.condition !== 'environment-ready') return task;
  const operationId = row.protocol.operationId;
  const operation = operationId && db.coordination.getOperation(run.projectId, operationId);
  return !operationId ||
    (operation &&
      operation.state === 'failed' &&
      ['environment_preflight_failed', SETTLED_ENVIRONMENT_FAILURE].includes(
        operation.evidence?.code ?? '',
      ))
    ? { ...task, environmentRetry: true }
    : task;
}
