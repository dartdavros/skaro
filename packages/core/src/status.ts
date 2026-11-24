// Computed statuses (docs/architecture.md, 3.2–3.3): only long-lived status is stored in the
// task file; "blocked", "needs answer" and milestone progress are derived.

import type { Milestone, Task, TaskStatus } from './artifacts/model.ts';

/**
 * Operational state of a task, kept in AppDb (not in git). "failed": the last turn ended in an
 * error and the agent is not working; the task keeps its stage.
 */
export type TaskRuntime = 'idle' | 'queued' | 'running' | 'waiting' | 'failed';

/**
 * The task failed: its last turn broke and no result was accepted. A task in review has an
 * accepted result: what broke after it (a limit, a merge) is in the feed, the task is no error.
 */
export function hasFailed(task: Pick<Task, 'status'>, runtime: TaskRuntime | undefined): boolean {
  return runtime === 'failed' && task.status !== 'review' && task.status !== 'done';
}

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
 * Unknown ids count as unfinished. Work that is already under way goes on over a dependency in
 * review: its exact accepted result was integrated into the checkout of the task.
 */
export function pendingDependencies(task: Task, index: TaskIndex): string[] {
  return task.dependsOn.filter((id) => {
    const dep = index.get(id);
    if (!dep) return true;
    if (dep.status === 'done') return false;
    return dep.status !== 'review';
  });
}

/** Dependencies not merged yet: a task is started from the base branch that has them all. */
export function unmergedDependencies(task: Task, index: TaskIndex): string[] {
  return task.dependsOn.filter((id) => index.get(id)?.status !== 'done');
}

/** A not-started task waits for the merge of its dependencies unless the user unblocked it. */
export function isBlocked(task: Task, index: TaskIndex): boolean {
  return task.status === 'todo' && !task.unblocked && unmergedDependencies(task, index).length > 0;
}

export function isTaskParked(status: TaskStatus): status is 'paused' | 'stopped' {
  return status === 'paused' || status === 'stopped';
}

export function displayStatus(
  task: Task,
  index: TaskIndex,
  runtime: TaskRuntime = 'idle',
): DisplayStatus {
  if (task.status === 'done') return 'done';
  if (isTaskParked(task.status) && runtime !== 'queued' && runtime !== 'running')
    return task.status;
  if (hasFailed(task, runtime)) return 'failed';
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

/** A board/registry refresh aggregates every milestone in one pass over task metadata. */
export function indexMilestoneProgress(tasks: readonly Task[]): Map<string, MilestoneProgress> {
  const result = new Map<string, MilestoneProgress>();
  for (const task of tasks) {
    if (!task.milestone || task.archived || task.status === 'cancelled') continue;
    const progress: MilestoneProgress = result.get(task.milestone) ?? {
      done: 0,
      total: 0,
      status: 'todo',
    };
    progress.total++;
    if (task.status === 'done') progress.done++;
    if (task.status !== 'todo') progress.status = 'in_progress';
    result.set(task.milestone, progress);
  }
  for (const progress of result.values())
    if (progress.total === progress.done) progress.status = 'done';
  return result;
}
export function milestoneProgress(
  milestone: Pick<Milestone, 'id'>,
  tasks: readonly Task[],
): MilestoneProgress {
  return indexMilestoneProgress(tasks).get(milestone.id) ?? { done: 0, total: 0, status: 'todo' };
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
