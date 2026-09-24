// Computed statuses (docs/architecture.md, 3.2–3.3): only long-lived status is stored in the
// task file; "blocked", "needs answer" and milestone progress are derived.

import type { Milestone, Task, TaskStatus } from './artifacts/model.ts';

/** Operational state of a task, kept in AppDb (not in git). */
export type TaskRuntime = 'idle' | 'queued' | 'running' | 'waiting';

/** Status as the UI shows it. */
export type DisplayStatus = TaskStatus | 'blocked' | 'queued' | 'needs_answer';

export type TaskIndex = ReadonlyMap<string, Task>;

export function indexTasks(tasks: readonly Task[]): TaskIndex {
  return new Map(tasks.map((t) => [t.id, t]));
}

/** Dependencies that are not done yet. Unknown ids count as unfinished. */
export function pendingDependencies(task: Task, index: TaskIndex): string[] {
  return task.dependsOn.filter((id) => index.get(id)?.status !== 'done');
}

/** A not-started task waits for unfinished dependencies unless the user unblocked it. */
export function isBlocked(task: Task, index: TaskIndex): boolean {
  return task.status === 'todo' && !task.unblocked && pendingDependencies(task, index).length > 0;
}

export function displayStatus(
  task: Task,
  index: TaskIndex,
  runtime: TaskRuntime = 'idle',
): DisplayStatus {
  if (runtime === 'waiting') return 'needs_answer';
  if (runtime === 'queued') return 'queued';
  if (runtime === 'running') return 'in_progress';
  return isBlocked(task, index) ? 'blocked' : task.status;
}

/** Why a task cannot be started now, or undefined if it can. */
export function startBlocker(
  task: Task,
  index: TaskIndex,
): 'archived' | 'blocked' | 'already_done' | 'in_progress' | undefined {
  if (task.archived) return 'archived';
  if (task.status === 'done') return 'already_done';
  if (task.status === 'in_progress' || task.status === 'review') return 'in_progress';
  if (isBlocked(task, index)) return 'blocked';
  return undefined;
}

export interface MilestoneProgress {
  done: number;
  /** Tasks that count: not archived, not cancelled. */
  total: number;
  status: 'todo' | 'in_progress' | 'done';
}

export function milestoneProgress(
  milestone: Pick<Milestone, 'id'>,
  tasks: readonly Task[],
): MilestoneProgress {
  const own = tasks.filter(
    (t) => t.milestone === milestone.id && !t.archived && t.status !== 'cancelled',
  );
  const done = own.filter((t) => t.status === 'done').length;
  const started = own.some((t) => t.status !== 'todo');
  return {
    done,
    total: own.length,
    status: own.length > 0 && done === own.length ? 'done' : started ? 'in_progress' : 'todo',
  };
}

/** Dependency cycles, each as a list of task ids (first id repeated at the end). */
export function dependencyCycles(tasks: readonly Task[]): string[][] {
  const index = indexTasks(tasks);
  const state = new Map<string, 'visiting' | 'done'>();
  const cycles: string[][] = [];
  const stack: string[] = [];
  const visit = (id: string) => {
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of index.get(id)?.dependsOn ?? []) {
      if (!index.has(dep)) continue;
      const s = state.get(dep);
      if (s === 'visiting') cycles.push([...stack.slice(stack.indexOf(dep)), dep]);
      else if (!s) visit(dep);
    }
    stack.pop();
    state.set(id, 'done');
  };
  for (const task of tasks) if (!state.has(task.id)) visit(task.id);
  return cycles;
}

/** Would adding `dependsOn` to `taskId` create a cycle? */
export function wouldCreateCycle(
  tasks: readonly Task[],
  taskId: string,
  dependsOn: string,
): boolean {
  if (taskId === dependsOn) return true;
  const index = indexTasks(tasks);
  const seen = new Set<string>();
  const queue = [dependsOn];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(index.get(id)?.dependsOn ?? []));
  }
  return false;
}

/** Tasks blocked before and not blocked after a change (e.g. a merge marking a task done). */
export function newlyUnblocked(before: readonly Task[], after: readonly Task[]): string[] {
  const beforeIndex = indexTasks(before);
  const afterIndex = indexTasks(after);
  return after
    .filter((t) => {
      const old = beforeIndex.get(t.id);
      return old !== undefined && isBlocked(old, beforeIndex) && !isBlocked(t, afterIndex);
    })
    .map((t) => t.id);
}
