// Computed statuses (docs/architecture.md, 3.2–3.3): only long-lived status is stored in the
// task file; "blocked", "needs answer" and milestone progress are derived.

import type { Milestone, Task, TaskStatus } from './artifacts/model.ts';

/**
 * Operational state of a task, kept in AppDb (not in git). "failed": the last turn ended in an
 * error and the agent is not working; the task keeps its stage (in progress, in review).
 */
export type TaskRuntime = 'idle' | 'queued' | 'running' | 'waiting' | 'failed';

/** An agent works on the task or the task waits in line for one. */
export function isAgentBusy(runtime: TaskRuntime | undefined): boolean {
  return runtime === 'queued' || runtime === 'running' || runtime === 'waiting';
}

/** Status as the UI shows it. */
export type DisplayStatus = TaskStatus | 'blocked' | 'queued' | 'needs_answer';

export type TaskIndex = ReadonlyMap<string, Task>;

export function indexTasks(tasks: readonly Task[]): TaskIndex {
  return new Map(tasks.map((t) => [t.id, t]));
}

/**
 * Tasks of one milestone that work in the milestone's branch: neither has a branch of its own
 * (a task started before stage execution keeps its own branch and merges by itself).
 */
export function sharesStage(task: Task, other: Task): boolean {
  return (
    task.milestone !== undefined &&
    task.milestone === other.milestone &&
    !task.branch &&
    !other.branch
  );
}

/**
 * Dependencies that are not done yet. Unknown ids count as unfinished. Inside a stage a
 * dependency in review is enough: its work is already in the branch the task will run in.
 */
export function pendingDependencies(task: Task, index: TaskIndex): string[] {
  return task.dependsOn.filter((id) => {
    const dep = index.get(id);
    if (!dep) return true;
    if (dep.status === 'done') return false;
    return !(dep.status === 'review' && sharesStage(task, dep));
  });
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
  if (task.status === 'done') return 'done';
  if (runtime === 'failed') return 'failed';
  if (runtime === 'waiting') return 'needs_answer';
  if (runtime === 'queued') return 'queued';
  if (runtime === 'running') return 'in_progress';
  if (isBlocked(task, index)) return 'blocked';
  // Started, but no agent works on it now: it waits for the user (a reply, unmet criteria).
  return task.status === 'in_progress' ? 'needs_answer' : task.status;
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
