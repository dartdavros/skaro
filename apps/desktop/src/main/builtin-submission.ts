import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readRuntimeJournal, requireRecordedSubmission } from '@skaro/agent-runtime';
import type { SkaroScope } from '@skaro/timeline';
import type { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { builtinSessionDirectory } from './builtin-session-directory';
import { builtinAcceptancePort } from './builtin-acceptance';

/** Applies only to the genuine current builtin run; managed submit_result keeps its contract. */
export async function requireBuiltinSubmission(
  ctx: TaskRunEngine,
  active: ActiveRun,
  scope: SkaroScope,
  claimedNumbers: readonly number[],
) {
  const lease = active.builtinAdmission;
  const sessionId = active.run.nativeSessionId;
  if (
    !lease ||
    !active.session ||
    !sessionId ||
    sessionId !== lease.admission.sessionId ||
    active.run.id !== scope.runId ||
    active.switching ||
    active.stopping ||
    active.stopError
  )
    throw new Error('Builtin submission requires the current active native admission');
  const signal = lease.signal;
  await lease.requireActive(lease.admission, signal);
  const primary = join(
    builtinSessionDirectory(ctx.deps.dataDir, 'tasks', active.run.id, sessionId),
    'journal.jsonl',
  );
  const journal = await readRuntimeJournal(primary, sessionId);
  const configScope = journal.state.config?.model?.scope;
  if (!isDeepStrictEqual(configScope, scope))
    throw new Error('Submission journal scope differs from the current task');
  const port = builtinAcceptancePort(ctx, scope, lease);
  const host = await port.inspect(lease.admission, signal);
  const claimedIds = claimedNumbers.map((number) => {
    const criterion = host.criteria[number - 1];
    if (!criterion) throw new Error('Submission criterion number is not authoritative');
    return criterion.id;
  });
  await requireRecordedSubmission(journal, host, signal, claimedIds);
  const after = await port.inspect(lease.admission, signal);
  if (after.revision !== host.revision)
    throw new Error('Task acceptance changed during submission verification');
  await lease.requireActive(lease.admission, signal);
}
