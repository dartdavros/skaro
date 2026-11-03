import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { SkaroScope } from '@skaro/timeline';
import type { TaskRunEngine } from './task-run-engine';
import { serializeTaskMutation } from './project-task-mutations';
import { builtinRunSettings } from './builtin-run-settings';
import { taskSessionOptions } from './task-session-options';
import { builtinTaskAdmission } from './builtin-task-admission';
import { builtinSessionDirectory } from './builtin-session-directory';
import { retireNativeSession } from './native/session-retirement';

/** Main-only review/metadata lease over a genuine stopped run. Never acknowledges input or spawns a model. */
export async function prepareBuiltinTaskReview(
  ctx: TaskRunEngine,
  projectId: string,
  taskId: string,
) {
  const context = ctx.project(projectId);
  return serializeTaskMutation(context, async () => {
    const active = await ctx.history.restore(projectId, taskId);
    if (
      !active ||
      active.run.agent !== 'skaro' ||
      active.session ||
      active.attaching ||
      active.switching ||
      active.stopping ||
      active.builtinAdmission ||
      ctx.closing ||
      ctx.scheduling.holdsSlot(projectId, taskId)
    )
      throw new Error('Builtin review requires the real stopped current task run');
    const artifacts = await context.load();
    const settings = builtinRunSettings(ctx, active);
    const options = await taskSessionOptions(ctx, active, artifacts, settings, active.segments);
    const scope: SkaroScope = { kind: 'task', projectId, taskId, runId: active.run.id };
    const sessionId = active.run.nativeSessionId ?? randomUUID();
    const startup = new AbortController();
    await ctx.processes.stop(active.run.id);
    const admissions = await builtinTaskAdmission(ctx, scope, sessionId, startup.signal);
    const directory = builtinSessionDirectory(ctx.deps.dataDir, 'tasks', active.run.id, sessionId);
    let closing: Promise<void> | undefined;
    return {
      scope,
      sessionId,
      journalPath: join(directory, 'journal.jsonl'),
      artifactDir: join(directory, 'artifacts'),
      options,
      admissions,
      signal: AbortSignal.any([startup.signal, admissions.signal]),
      run: structuredClone(active.run),
      close() {
        return (closing ??= (async () => {
          startup.abort();
          await retireNativeSession(active, 'Builtin task review finished', () =>
            ctx.processes.stop(active.run.id),
          );
        })());
      },
    };
  });
}
