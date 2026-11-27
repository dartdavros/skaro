import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  applyC4Package,
  parseMarkdown,
  serializeMarkdown,
  setFields,
  type AppDb,
} from '@skaro/core';
import type { ProjectContext } from './projects';
import { assertC4TaskReview, c4ChangeHash } from './c4-review';
import { prepareC4Publication } from './c4-publication';
import { readSubject, updateSubject } from './task-subject';
import { captureInPlaceResult, type InPlaceSubmission } from './completion-in-place';
import { CompletionStore } from './completion-store';

/** In-place code is already in the owner's checkout; complete its verified architecture there. */
export async function completeInPlaceC4(
  db: AppDb,
  context: ProjectContext,
  taskId: string,
  runId: string,
  submission: InPlaceSubmission = {},
): Promise<void> {
  const review = await assertC4TaskReview(db, context, taskId, context.root, runId);
  context.invalidate();
  const artifacts = await context.load();
  const pkg = await prepareC4Publication(context.root, artifacts, review.realized);
  if (review.changeHash !== (await c4ChangeHash(context.root, review.baseHead)))
    throw new Error(`${taskId}: code changed during in-place completion; review C4 again`);
  const result = /^T-\d+$/.test(taskId)
    ? await captureInPlaceResult(
        db,
        context,
        await readSubject(context, taskId),
        review,
        submission,
      )
    : undefined;
  if (review.changeHash !== (await c4ChangeHash(context.root, review.baseHead)))
    throw new Error(`${taskId}: code changed before in-place completion; review C4 again`);
  if (pkg && /^T-\d+$/.test(taskId)) {
    const task = await readSubject(context, taskId);
    const path = task.path.replace(/^\.skaro\//, '');
    const before = await readFile(join(context.root, task.path), 'utf8');
    const file = parseMarkdown(before);
    setFields(file, { status: 'done' });
    pkg.completion = { taskId, path };
    pkg.files.push({ path, before, after: serializeMarkdown(file) });
    await applyC4Package(context.root, pkg);
  } else {
    if (pkg) await applyC4Package(context.root, pkg);
    await updateSubject(context, taskId, { status: 'done' });
  }
  if (result) {
    const store = new CompletionStore(db, context.id);
    store.saveResult({ ...result, pendingReview: false });
    store.issue(taskId);
    store.conflict(taskId, false);
  }
  context.invalidate();
}
