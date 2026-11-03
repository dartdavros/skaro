import { isDeepStrictEqual } from 'node:util';
import type { AppDb } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import { parseBuiltinTaskStart, type BuiltinTaskStart } from './builtin-task-start';
import { key } from './task-run-helpers';

export const builtinRunSettingsKey = (runId: string) => `builtin.run.${runId}.settings`;

export function saveBuiltinRunSettings(db: AppDb, runId: string, settings: BuiltinTaskStart) {
  db.setSetting(builtinRunSettingsKey(runId), parseBuiltinTaskStart(settings));
}

/** Missing launch state is an explicit refusal, never a fallback to project permission defaults. */
export function builtinRunSettings(ctx: TaskRunEngine, active: ActiveRun): BuiltinTaskStart {
  const { projectId, taskId, run } = active;
  const saved = ctx.deps.db.getRun(run.id);
  if (
    ctx.active.get(key(projectId, taskId)) !== active ||
    !saved ||
    saved.projectId !== projectId ||
    saved.taskId !== taskId ||
    saved.agent !== 'skaro' ||
    run.agent !== 'skaro' ||
    saved.retiredAt !== undefined
  )
    throw new Error('Builtin run settings require the actual current task run');
  let selected = ctx.deps.db.getSetting<unknown>(builtinRunSettingsKey(run.id), null);
  if (!selected && !saved.nativeSessionId && !run.nativeSessionId) {
    // Crash between createRun and saving its settings cannot have admitted a process yet.
    const pending = ctx.startup.read(projectId, taskId)?.builtin;
    if (pending && pending.model === saved.model) {
      saveBuiltinRunSettings(ctx.deps.db, run.id, pending);
      selected = pending;
    }
  }
  const settings = parseBuiltinTaskStart(selected);
  if (
    settings.model !== saved.model ||
    !isDeepStrictEqual(saved.model, run.model) ||
    (settings.isolation === 'worktree') !== !!saved.worktree
  )
    throw new Error('Builtin task model differs from its recorded launch selection');
  return settings;
}
