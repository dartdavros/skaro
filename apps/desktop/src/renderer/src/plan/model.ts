// "План" (Plan mockup): milestones with their tasks in order, marks, progress and relations.

import type { MilestoneInfo, TaskSummary } from '../../../shared/ipc';

export type RowStatus =
  'todo' | 'blocked' | 'working' | 'need' | 'review' | 'error' | 'done' | 'cancel';

export function rowStatus(status: TaskSummary['status']): RowStatus {
  switch (status) {
    case 'in_progress':
    case 'queued':
      return 'working';
    case 'needs_answer':
      return 'need';
    case 'failed':
      return 'error';
    case 'cancelled':
      return 'cancel';
    default:
      return status;
  }
}

export const doneLike = (s: RowStatus) => s === 'done' || s === 'cancel';

export interface Stage {
  milestone: MilestoneInfo;
  /** "Без этапа": tasks without a milestone; no goal, no menu, not dragged (D-32). */
  loose?: boolean;
  /** All tasks of the milestone in order. */
  tasks: TaskSummary[];
  done: number;
  /** Tasks that count: all but cancelled. */
  total: number;
  working: number;
  attention: number;
  errors: number;
}

export function stages(
  milestones: MilestoneInfo[],
  tasks: TaskSummary[],
  looseTitle = '',
): Stage[] {
  const live = tasks.filter((x) => !x.archived);
  // Tasks without a milestone close the plan as "Без этапа"; the block is shown only with tasks.
  const loose = live.some((x) => !x.milestone)
    ? [{ id: '', title: looseTitle, order: Number.MAX_SAFE_INTEGER }]
    : [];
  return [...milestones, ...loose].map((milestone) => {
    const own = live
      .filter((x) => (x.milestone?.id ?? '') === milestone.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const count = (...kinds: RowStatus[]) =>
      own.filter((x) => kinds.includes(rowStatus(x.status))).length;
    return {
      milestone,
      ...(milestone.id === '' ? { loose: true } : {}),
      tasks: own,
      done: count('done'),
      total: own.length - count('cancel'),
      working: count('working'),
      attention: count('need', 'review'),
      errors: count('error'),
    };
  });
}

/** Hovering a task lights up what it needs (upstream) and what needs it (downstream). */
export function relations(
  hovered: TaskSummary | undefined,
  tasks: TaskSummary[],
): { up: Set<string>; down: Set<string> } {
  if (!hovered) return { up: new Set(), down: new Set() };
  return {
    up: new Set(hovered.deps),
    down: new Set(tasks.filter((x) => x.deps.includes(hovered.id)).map((x) => x.id)),
  };
}

/** Where a milestone's tasks go when it is deleted: the previous one, the next for the first. */
export function heirOf(milestones: MilestoneInfo[], id: string): MilestoneInfo | undefined {
  const i = milestones.findIndex((m) => m.id === id);
  return i > 0 ? milestones[i - 1] : milestones[i + 1];
}

/** What is being dragged on the plan and where it would land. */
export interface Drag {
  kind: 'stage' | 'task';
  id: string;
}

export type Over =
  { kind: 'stage'; index: number } | { kind: 'task'; stage: string; index: number };
