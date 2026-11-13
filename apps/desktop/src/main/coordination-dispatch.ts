import type { AppDb } from '@skaro/core';
import type { CoordinatorDispatchState as DispatchState } from '../shared/coordination-control';
import { TaskExecution } from './task-execution';
import { activationBlocksDispatch, activationKey } from './archiagent-activation-state';
import {
  fenceIntegrationDispatch,
  integrationDispatchCandidates,
} from './integration-dispatch-fence';
export class CoordinationSuspended extends Error {
  constructor() {
    super('Project coordination dispatch is suspended; a fresh owner request is required.');
  }
}
export function dispatchState(db: AppDb, projectId: string): DispatchState {
  if ((db.shell.projectScope && db.shell.projectScope !== projectId) || !db.getProject(projectId))
    throw new Error('Coordinator project scope invalid');
  const value = db.getSetting<DispatchState>(
    `coordination.dispatch.${projectId}`,
    { enabled: true, revision: 0 },
    { strict: true },
  );
  if (
    typeof value?.enabled !== 'boolean' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  )
    throw new Error('Invalid coordinator dispatch state');
  return value;
}
export function migrationBlocksDispatch(db: AppDb, projectId: string): boolean {
  const migration = db.getSetting<{ version: number; blocked: boolean } | undefined>(
    `coordination.migration.v1.${projectId}`,
    undefined,
    { strict: true },
  );
  return (
    activationBlocksDispatch(db, projectId) ||
    (migration !== undefined && (migration?.version !== 1 || migration?.blocked !== false))
  );
}
export function requireCoordinationDispatch(db: AppDb, projectId: string, revision?: number) {
  const current = dispatchState(db, projectId);
  if (
    !current.enabled ||
    migrationBlocksDispatch(db, projectId) ||
    (revision !== undefined && revision !== current.revision)
  )
    throw new CoordinationSuspended();
  return current;
}
export function setCoordinationDispatch(
  db: AppDb,
  projectId: string,
  enabled: boolean,
  expected: number,
) {
  const current = dispatchState(db, projectId),
    key = `coordination.dispatch.${projectId}`;
  if (typeof enabled !== 'boolean' || current.revision !== expected)
    throw new Error('Coordinator dispatch changed');
  if (enabled && migrationBlocksDispatch(db, projectId))
    throw new Error('Coordinator migration requires owner review');
  if (enabled && db.getSetting(activationKey(projectId), undefined, { strict: true }) !== undefined)
    throw new Error('Managed activation requires the atomic archiagent barrier');
  const stored = db.getSetting<DispatchState | undefined>(key, undefined, { strict: true });
  const next = { enabled, revision: expected + 1 };
  const candidates = enabled ? [] : integrationDispatchCandidates(db, projectId);
  db.settings.atomic(() => {
    if (!db.settings.compareAndSet(key, stored, next))
      throw new Error('Coordinator dispatch changed');
    if (!enabled) for (const run of db.listRuns(projectId)) new TaskExecution(db, run.id).stop();
    if (!enabled) fenceIntegrationDispatch(db, projectId, candidates);
    if (!enabled)
      for (const command of db.commands.pending())
        if (command.args[0] === projectId && command.state === 'accepted')
          db.commands.update(
            command.id,
            'uncertain',
            'Dispatch suspended before delivery; an explicit renewed request is required.',
          );
    db.addEvent(projectId, 'coordinator_dispatch_changed', next);
  });
  return next;
}
const safetyActions = new Set([
  'ipc.task.interrupt',
  'ipc.chat.interrupt',
  'ipc.task.stop_background',
  'ipc.tasks.cancel',
  'ipc.stages.stop',
  'ipc.incidents.revoke',
  'ipc.incidents.cancel',
  'mcp.report_task_blocker',
  'incident.report',
]);
export const dispatchSafetyAction = (action: string) => safetyActions.has(action);
