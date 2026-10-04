// Stage execution: the tasks of a milestone work one after another in the milestone's branch,
// checkout and environment, and are merged together with it. A task without a milestone, and a
// task that already has a branch of its own, keeps its own checkout and merges by itself.

import { basename, dirname } from 'node:path';
import type { AppDb, Milestone, ProjectArtifacts, RunRecord, Task, TaskKey } from '@skaro/core';

/** The milestone whose branch the task works in, if it does not have a branch of its own. */
export function stageOf(task: Task, artifacts: ProjectArtifacts): Milestone | undefined {
  if (!task.milestone || task.branch) return undefined;
  return artifacts.milestones.find((m) => m.id === task.milestone);
}

/** Tasks that work in the branch of the milestone. */
export function stageTasks(stage: Pick<Milestone, 'id'>, artifacts: ProjectArtifacts): Task[] {
  return artifacts.tasks.filter((t) => t.milestone === stage.id && !t.branch && !t.archived);
}

type RunCheckout = Pick<RunRecord, 'worktree' | 'taskId' | 'projectId'>;

/**
 * The milestone a run works in the checkout of. Skaro keeps checkouts in
 * worktrees/<project>/<owner>: the owner is the task itself, or the milestone its tasks share.
 */
export function stageIdOf(run: RunCheckout): string | undefined {
  if (!run.worktree) return undefined;
  const project = dirname(run.worktree);
  const managed = basename(project) === run.projectId && basename(dirname(project)) === 'worktrees';
  const owner = basename(run.worktree);
  return managed && owner !== run.taskId ? owner : undefined;
}

/** The checkout, if any, is the task's own: nothing else works in it. */
export function ownsCheckout(run: RunCheckout): boolean {
  return stageIdOf(run) === undefined;
}

/** Whose environment a run uses: tasks of a stage share one, named after the milestone. */
export function checkoutKey(active: {
  projectId: string;
  taskId: string;
  run: RunRecord;
}): TaskKey {
  return { projectId: active.projectId, taskId: stageIdOf(active.run) ?? active.taskId };
}

/** What Skaro remembers about the branch of a stage; kept in AppDb, not in git. */
export interface StageLedger {
  /** Where the work of each unfinished task began: it becomes one commit from there. */
  open: Record<string, string>;
  /** One commit per finished piece of work, in the order of the branch. */
  commits: { taskId: string; commit: string; message: string }[];
  /** Merges of the stage and the tasks each took: an undone merge returns them to review. */
  merged: { commit: string; tasks: string[] }[];
}

function ledgerKey(projectId: string, stageId: string): string {
  return `stage.${projectId}.${stageId}.ledger`;
}

export function readLedger(db: AppDb, projectId: string, stageId: string): StageLedger {
  const saved = db.getSetting<Partial<StageLedger> | null>(ledgerKey(projectId, stageId), null);
  return {
    open: { ...saved?.open },
    commits: [...(saved?.commits ?? [])],
    merged: [...(saved?.merged ?? [])],
  };
}

export function writeLedger(
  db: AppDb,
  projectId: string,
  stageId: string,
  ledger: StageLedger,
): void {
  db.setSetting(ledgerKey(projectId, stageId), ledger);
}
