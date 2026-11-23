// Accepting a result: the work of the task is committed in its own checkout and recorded with
// its exact SHA before the task goes to review. The merge reads this record, never the branch tip.

import { git, type ProjectCheck } from '@skaro/core';
import { isDeepStrictEqual } from 'node:util';
import type { CompletionHooks } from './completion-coordinator';
import { CompletionStore, criteriaRevision, type TaskResult } from './completion-store';
import { dependencySnapshot, preparedDependencies } from './completion-dependencies';
import { taskSections, withSummary } from './task-body';
import { assertC4TaskReview, c4ChangeHash, c4ReviewKey, type C4TaskReview } from './c4-review';
import { stageIdOf } from './task-stage';
import { submissionIdentity } from './submission-context';

export interface CapturedWork {
  projectId: string;
  taskId: string;
  branch: string;
  worktree: string;
  message: string;
  summary?: string | undefined;
  verification?: ProjectCheck[] | undefined;
}

export async function captureResult(hooks: CompletionHooks, work: CapturedWork): Promise<void> {
  const { projectId, taskId, branch, worktree, message, summary, verification } = work;
  const context = hooks.deps.projects.get(projectId);
  context.invalidate();
  const task = await context.store.readTask(taskId);
  if (task.status === 'done') return;
  if (taskSections(task.body).criteria.some((criterion) => !criterion.done))
    throw new Error(`${taskId}: acceptance criteria are unfinished`);
  const c4 = await assertC4TaskReview(hooks.deps.db, context, taskId, worktree);
  await context.git.commitAll(worktree, message);
  // Committing moves new files from the untracked set into the Git diff. The verified
  // content is unchanged; preserve the fingerprint of its now committed representation.
  const committedC4 = { ...c4, changeHash: await c4ChangeHash(worktree, c4.baseHead) };
  const reviewKey = c4ReviewKey(projectId, taskId);
  // A repeated/concurrent submission sees the same verified content after commit.
  // Preserve a newer explicit review if another caller has replaced this one.
  if (isDeepStrictEqual(hooks.deps.db.getSetting<C4TaskReview | null>(reviewKey, null), c4))
    hooks.deps.db.setSetting(reviewKey, committedC4);
  const head = await context.git.head('HEAD', worktree);
  const store = new CompletionStore(hooks.deps.db, projectId);
  const result: TaskResult = {
    submission: submissionIdentity(projectId, taskId),
    taskId,
    branch,
    worktree,
    sharedCheckout: !!stageIdOf({ projectId, taskId, worktree }),
    head,
    message,
    criteria: criteriaRevision(task),
    dependencies: dependencySnapshot(preparedDependencies(hooks.deps.db, projectId, taskId)),
    c4: committedC4,
    ...(summary ? { summary } : {}),
    ...(verification ? { verification } : {}),
    pendingReview: true,
  };
  await git(context.root, ['update-ref', `refs/skaro/results/${taskId}/${head}`, head]);
  store.saveResult(result);
  await context.store.updateTask(taskId, {
    status: 'review',
    ...(!task.branch && !result.sharedCheckout ? { branch } : {}),
    ...(summary ? { body: withSummary(task.body, summary) } : {}),
  });
  store.saveResult({ ...result, pendingReview: false });
  store.issue(taskId);
  // The first conflict remains recorded until publication so a second one goes to coordination.
  context.invalidate();
  hooks.deps.emit('project.changed', { projectId });
}
