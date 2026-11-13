import type { AppDb } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import type { SavedEnvironmentReview } from './task-environment-review-state';
import { resourcesFor } from './resource-execution';

const KEY = 'environment.reviews';
export function savedEnvironmentReviews(db: AppDb): SavedEnvironmentReview[] {
  return db
    .getSetting<SavedEnvironmentReview[]>(KEY, [])
    .filter((review) => !db.shell.projectScope || review.projectId === db.shell.projectScope);
}
export function saveEnvironmentReviews(db: AppDb, reviews: SavedEnvironmentReview[]): void {
  const foreign = db.shell.projectScope
    ? db
        .getSetting<SavedEnvironmentReview[]>(KEY, [])
        .filter((review) => review.projectId !== db.shell.projectScope)
    : [];
  db.setSetting(KEY, [...foreign, ...reviews]);
}
export async function recoverEnvironmentReviews(ctx: TaskRunEngine): Promise<void> {
  for (const review of savedEnvironmentReviews(ctx.deps.db)) {
    await ctx.processes.stop(review.id);
    const resources = resourcesFor(ctx.deps.db);
    const owner = `review:${review.taskId}`;
    const holding = resources?.holdings(review.projectId, owner)[0];
    await ctx.environments.stop(review.environment, holding, true);
    resources?.releaseOwner(
      review.projectId,
      owner,
      'recovered_review_processes_and_services_stopped',
    );
  }
  saveEnvironmentReviews(ctx.deps.db, []);
}
