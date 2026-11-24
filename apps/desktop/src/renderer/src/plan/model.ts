// "План" (Plan mockup): milestones with their tasks in order, marks, progress and relations.

import type { TaskSummary } from '../../../shared/ipc';

export type RowStatus =
  | 'todo'
  | 'blocked'
  | 'working'
  | 'need'
  | 'paused'
  | 'stopped'
  | 'review'
  | 'error'
  | 'done'
  | 'cancel';

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

export type Stage = import('../../../shared/plan-catalog').PlanStage;

/** "В архив": a milestone whose tasks are all done or cancelled. */
export const canArchive = (stage: Stage): boolean =>
  stage.taskCount > 0 && stage.done === stage.total;
