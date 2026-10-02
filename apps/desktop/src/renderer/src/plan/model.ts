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
  /** The tasks of the milestone in order: live ones on the plan, archived ones in the archive. */
  tasks: TaskSummary[];
  done: number;
  /** Tasks that count: all but cancelled. */
  total: number;
  working: number;
  attention: number;
  errors: number;
}

function group(
  milestones: MilestoneInfo[],
  tasks: TaskSummary[],
  looseTitle: string,
  keep: (milestone: MilestoneInfo, own: TaskSummary[]) => boolean,
): Stage[] {
  // Tasks without a milestone close the list as "Без этапа"; the block is shown only with tasks.
  const loose = tasks.some((x) => !x.milestone)
    ? [{ id: '', title: looseTitle, order: Number.MAX_SAFE_INTEGER }]
    : [];
  return [...milestones, ...loose].flatMap((milestone) => {
    const own = tasks
      .filter((x) => (x.milestone?.id ?? '') === milestone.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (!keep(milestone, own)) return [];
    const count = (...kinds: RowStatus[]) =>
      own.filter((x) => kinds.includes(rowStatus(x.status))).length;
    return [
      {
        milestone,
        ...(milestone.id === '' ? { loose: true } : {}),
        tasks: own,
        done: count('done'),
        total: own.length - count('cancel'),
        working: count('working'),
        attention: count('need', 'review'),
        errors: count('error'),
      },
    ];
  });
}

/**
 * The plan: milestones with their live tasks. A milestone is archived when all its tasks are —
 * it is not stored, so the plan and the board cannot disagree. A milestone without tasks stays.
 */
export function stages(
  milestones: MilestoneInfo[],
  tasks: TaskSummary[],
  looseTitle = '',
): Stage[] {
  const live = tasks.filter((x) => !x.archived);
  return group(
    milestones,
    live,
    looseTitle,
    (m, own) => own.length > 0 || m.id === '' || !tasks.some((x) => x.milestone?.id === m.id),
  );
}

/** The archive: archived tasks under their milestones, also under one still on the plan. */
export function archive(
  milestones: MilestoneInfo[],
  tasks: TaskSummary[],
  looseTitle = '',
): Stage[] {
  return group(
    milestones,
    tasks.filter((x) => x.archived),
    looseTitle,
    (_m, own) => own.length > 0,
  );
}

/** "В архив": a milestone whose tasks are all done or cancelled. */
export const canArchive = (stage: Stage): boolean =>
  stage.tasks.length > 0 && stage.tasks.every((x) => doneLike(rowStatus(x.status)));

/** "Удалить этап": only while no task of it (archived ones too) has been started. */
export const canDelete = (milestoneId: string, tasks: TaskSummary[]): boolean =>
  tasks
    .filter((x) => x.milestone?.id === milestoneId)
    .every((x) => x.stage === 'todo' && (x.status === 'todo' || x.status === 'blocked'));

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
