import type { SkaroScope } from '@skaro/timeline';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import { NativeAdmissions } from './native/admissions';
import { key } from './task-run-helpers';

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
  const current = async (signal: AbortSignal) => {
    signal.throwIfAborted();
    const saved = engine.deps.db.getRun(runId);
    if (
      engine.closing ||
      active.switching ||
      engine.active.get(key(projectId, taskId)) !== active ||
      active.run.id !== runId ||
      active.run.agent !== 'skaro' ||
      !saved ||
      saved.retiredAt !== undefined ||
      saved.projectId !== projectId ||
      saved.taskId !== taskId ||
      saved.agent !== 'skaro' ||
      (saved.nativeSessionId && saved.nativeSessionId !== sessionId) ||
      (active.run.nativeSessionId && active.run.nativeSessionId !== sessionId)
    )
      throw new Error('Builtin task admission is no longer current');
    signal.throwIfAborted();
  };
  const lease = await NativeAdmissions.prepare({
    db: engine.deps.db,
    ownerKey: `task:${projectId}:${taskId}:${runId}`,
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

export async function revokeBuiltinTaskAdmission(active: ActiveRun, reason: string) {
  const lease = active.builtinAdmission;
  if (lease) await lease.revoke(lease.admission, reason);
  return lease;
}
export async function confirmBuiltinTaskExit(active: ActiveRun, lease?: NativeAdmissions) {
  if (!lease) return;
  await lease.confirmExit(lease.admission);
  if (active.builtinAdmission === lease) active.builtinAdmission = undefined;
}
