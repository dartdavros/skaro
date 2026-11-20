import { git, type ProjectArtifacts } from '@skaro/core';
import { withSkaroNote } from '@skaro/timeline';
import type { MessageInput } from '../shared/ipc';
import type { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import {
  taskInputSnapshot,
  verifyPrerequisites,
  type TaskInputSnapshot,
} from './task-preflight-inputs';
import { prepareTaskDependencies } from './task-dependency-checkout';
import { projectMemory } from './project-memory-binding';
import { publicMemoryText } from './project-memory-sources';

/** Every delivery, including an existing native session, refreshes immutable inputs before dispatch. */
export async function readTaskInputs(ctx: TaskRunEngine, active: ActiveRun) {
  const context = ctx.project(active.projectId);
  const artifacts = await context.store.load();
  const snapshot = await taskInputSnapshot(ctx.deps.db, context, artifacts, active.taskId);
  return { artifacts, snapshot };
}

export async function taskPreflight(
  ctx: TaskRunEngine,
  active: ActiveRun,
  input: MessageInput,
  { artifacts, snapshot }: { artifacts: ProjectArtifacts; snapshot: TaskInputSnapshot },
  previous: TaskInputSnapshot | null,
): Promise<MessageInput> {
  const context = ctx.project(active.projectId);
  const key = `coordination.inputs.${active.run.id}`;
  const changed = !!previous && previous.version !== snapshot.version;
  const cwd = active.run.worktree ?? context.root;
  // Dirty work is never overwritten by a newly accepted dependency, even on native resume.
  const dependencyChanged =
    previous && JSON.stringify(previous.dependencies) !== JSON.stringify(snapshot.dependencies);
  if (dependencyChanged && (await git(cwd, ['status', '--porcelain'])).stdout.trim())
    throw new Error(
      `${active.taskId}: dependency version changed; preserve uncommitted work before integration`,
    );
  if (active.run.worktree)
    await prepareTaskDependencies(
      ctx,
      active.projectId,
      artifacts.tasks.find((t) => t.id === active.taskId)!,
      artifacts,
      cwd,
    );
  else if (snapshot.dependencies.some((d) => d.status === 'review'))
    throw new Error('In-place task cannot use unpublished dependencies');
  await verifyPrerequisites(artifacts, active.taskId, cwd);
  const current = await taskInputSnapshot(
    ctx.deps.db,
    context,
    await context.store.load(),
    active.taskId,
  );
  if (current.version !== snapshot.version)
    throw new Error('Task inputs changed during preflight; no worker dispatch');
  ctx.deps.db.setSetting(key, snapshot);
  if (changed)
    ctx.deps.db.addEvent(active.projectId, 'task_inputs_changed', {
      task: active.taskId,
      previous: previous.version,
      current: snapshot.version,
    });
  const task = artifacts.tasks.find((t) => t.id === active.taskId)!;
  const note = [
    'Input snapshot: ' + snapshot.version,
    changed
      ? `Task inputs changed (${changedTaskInputs(previous, snapshot).join(', ')}). Read the current task, architecture, accepted ADRs and applicable specification before acting.`
      : '',
    publicMemoryText(task.body),
    'Accepted code inputs: ' + JSON.stringify(snapshot.dependencies),
    'Prerequisite artifacts/services were checked independently of task statuses. Result-phase inputs are checked after implementation.',
    (await projectMemory(ctx.deps.db)?.note(active.projectId)) ?? '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { ...input, text: withSkaroNote(note, input.text) };
}

function changedTaskInputs(previous: TaskInputSnapshot, current: TaskInputSnapshot) {
  return (
    ['requirements', 'dependencies', 'environment', 'checks', 'workflow', 'authority'] as const
  ).filter((field) => JSON.stringify(previous[field]) !== JSON.stringify(current[field]));
}

/** Native admission can wait; compare again immediately before the expensive resumed operation. */
export async function taskInputsCurrent(ctx: TaskRunEngine, active: ActiveRun): Promise<boolean> {
  const saved = ctx.deps.db.getSetting<TaskInputSnapshot | null>(
    `coordination.inputs.${active.run.id}`,
    null,
  );
  if (!saved) throw new Error('Task has no validated input snapshot');
  const context = ctx.project(active.projectId);
  const current = await taskInputSnapshot(
    ctx.deps.db,
    context,
    await context.store.load(),
    active.taskId,
  );
  return current.version === saved.version;
}

export async function requireTaskInputsCurrent(
  ctx: TaskRunEngine,
  active: ActiveRun,
): Promise<void> {
  if (!(await taskInputsCurrent(ctx, active)))
    throw new Error('Task input snapshot became stale during resource admission');
}
