import { basename, resolve } from 'node:path';
import type { RunRecord, Task } from '@skaro/core';

export type RetainedCheckout = {
  branch: string;
  head: string;
  cleanedAt?: number;
  /** Written only at the verified destructive checkpoint, never inferred from an absent path. */
  trackedClean?: {
    resourceId: string;
    generation: number;
    operationId: string;
    branch: string;
    head: string;
  };
};
export const recordKey = (path: string) => `worktree.cleaned.${resolve(path)}`;
export const accessKey = (path: string) => `worktree.accessed.${resolve(path)}`;

/** Legacy OS handoffs have no verified close signal. Never expire these unknown consumers. */
export function restoredCheckoutInUse(
  _cleaned: RetainedCheckout | null,
  accessed: number,
  _now = Date.now(),
): boolean {
  return !Number.isSafeInteger(accessed) || accessed < 0 || accessed > 0;
}

export function checkoutTaskIds(
  path: string,
  runs: Pick<RunRecord, 'taskId' | 'worktree'>[],
): Set<string> {
  return new Set([
    basename(path),
    ...runs.filter((run) => run.worktree === path).map((run) => run.taskId),
  ]);
}

export function completedCheckout(
  tasks: Pick<Task, 'id' | 'milestone' | 'status'>[],
  owner: string,
) {
  const task = tasks.find((item) => item.id === owner);
  const members = task ? [task] : tasks.filter((item) => item.milestone === owner);
  return members.length > 0 && members.every((item) => item.status === 'done');
}
