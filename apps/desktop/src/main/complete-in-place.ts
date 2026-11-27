import type { AppDb } from '@skaro/core';
import type { ProjectContext } from './projects';
import { readSubject, updateSubject } from './task-subject';
import { captureInPlaceResult, type InPlaceSubmission } from './completion-in-place';
import { assertResultUnchanged } from './completion-results';
import { CompletionStore } from './completion-store';

/** In-place code is already in the owner's checkout; record the exact accepted source tree. */
export async function completeInPlace(
  db: AppDb,
  context: ProjectContext,
  taskId: string,
  runId: string,
  submission: InPlaceSubmission = {},
): Promise<void> {
  const result = /^T-\d+$/.test(taskId)
    ? await captureInPlaceResult(db, context, await readSubject(context, taskId), runId, submission)
    : undefined;
  if (result) await assertResultUnchanged(context, result);
  await updateSubject(context, taskId, { status: 'done' });
  if (result) {
    const store = new CompletionStore(db, context.id);
    store.saveResult({ ...result, pendingReview: false });
    store.issue(taskId);
    store.conflict(taskId, false);
  }
  context.invalidate();
}
