import type { SkaroScope } from '@skaro/timeline';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import { NativeAdmissions } from './native/admissions';
import { key } from './task-run-helpers';

export function requireCurrentBuiltinTask(
  engine: TaskRunEngine,
  scope: SkaroScope,
  sessionId: string,
  active: ActiveRun,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const saved = engine.deps.db.getRun(scope.runId!);
  if (
    engine.closing ||
    active.switching ||
    engine.active.get(key(scope.projectId, scope.taskId!)) !== active ||
    active.run.id !== scope.runId ||
    active.run.agent !== 'skaro' ||
    !saved ||
    saved.retiredAt !== undefined ||
    saved.projectId !== scope.projectId ||
    saved.taskId !== scope.taskId ||
    saved.agent !== 'skaro' ||
    (saved.nativeSessionId && saved.nativeSessionId !== sessionId) ||
    (active.run.nativeSessionId && active.run.nativeSessionId !== sessionId)
  )
    throw new Error('Builtin task admission is no longer current');
  signal.throwIfAborted();
}

/** The real task-run controller owns the lease; a runtime cannot create a matching ActiveRun. */
export async function builtinTaskAdmission(
  engine: TaskRunEngine,
  supplied: SkaroScope,
  sessionId: string,
  signal: AbortSignal,
): Promise<NativeAdmissions> {
  signal.throwIfAborted();
  const scope = structuredClone(supplied);
  if (
    scope.kind !== 'task' ||
    !scope.taskId ||
    !scope.runId ||
    Object.keys(scope).some((name) => !['kind', 'projectId', 'taskId', 'runId'].includes(name))
  )
    throw new Error('Builtin task admission requires an exact task/run scope');
  const { projectId, taskId, runId } = scope;
  const active = engine.active.get(key(projectId, taskId));
  if (!active || active.run.id !== runId || active.run.agent !== 'skaro')
    throw new Error('No matching active builtin task run');
  if (active.builtinAdmission) throw new Error('This task run already owns a builtin admission');
  const current = async (signal: AbortSignal) =>
    requireCurrentBuiltinTask(engine, scope, sessionId, active, signal);
  await current(signal);
  const ownerKey = `task:${projectId}:${taskId}:${runId}`;
  await NativeAdmissions.recover(engine.deps.db, ownerKey, signal);
  await current(signal);
  const lease = await NativeAdmissions.prepare({
    db: engine.deps.db,
    ownerKey,
    scope,
    sessionId,
    requireCurrent: current,
    signal,
  });
  try {
    await current(signal);
    if (active.builtinAdmission) throw new Error('Builtin task admission was already attached');
    active.builtinAdmission = lease;
    return lease;
  } catch (error) {
    await lease.revoke(lease.admission, 'Task changed while preparing admission');
    await lease.confirmExit(lease.admission);
    throw error;
  }
}

export {
  revokeNativeSession as revokeBuiltinTaskAdmission,
  confirmNativeSessionExit as confirmBuiltinTaskExit,
} from './native/session-lease';
