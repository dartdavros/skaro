import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { git, type AppDb, type ProjectArtifacts, type ProjectCheck, type Task } from '@skaro/core';
import type { ProjectContext } from './projects';
import { c4ChangeHash, type C4TaskReview } from './c4-review';
import { CompletionStore, criteriaRevision, type TaskResult } from './completion-store';
import { assertDependencyVersions, dependencySnapshot } from './completion-dependencies';
import { taskSections } from './task-body';
import { submissionIdentity } from './submission-context';

export interface InPlaceSubmission {
  message?: string;
  summary?: string;
  verification?: ProjectCheck[];
}

/** Freeze validated acceptance metadata without modifying the project or its database. */
export function inPlaceResult(
  db: AppDb,
  projectId: string,
  artifacts: ProjectArtifacts,
  task: Task,
  commit: { head: string; branch: string; c4: C4TaskReview },
  submission: InPlaceSubmission,
): TaskResult {
  if (taskSections(task.body).criteria.some((criterion) => !criterion.done))
    throw new Error(`${task.id}: acceptance criteria are unfinished`);
  const store = new CompletionStore(db, projectId);
  const inputs = task.dependsOn.map((id) => {
    const result = store.result(id);
    if (!result) throw new Error(`${id}: no accepted result`);
    return result;
  });
  const dependencies = dependencySnapshot(inputs);
  assertDependencyVersions(artifacts, dependencies, store, task.id);
  const snapshot = db.getSetting<{ dependencies: { taskId: string; head: string }[] } | null>(
    `coordination.inputs.${commit.c4.runId}`,
    null,
  );
  for (const input of snapshot?.dependencies ?? [])
    if (!dependencies.some((value) => value.taskId === input.taskId && value.head === input.head))
      throw new Error(`${task.id}: dependency ${input.taskId} changed after preflight`);
  const result: TaskResult = {
    submission: submissionIdentity(projectId, task.id),
    taskId: task.id,
    ...commit,
    sharedCheckout: true,
    inPlace: true,
    criteria: criteriaRevision(task),
    message: submission.message ?? `${task.id}: ${task.title}`,
    dependencies,
    ...(submission.summary ? { summary: submission.summary } : {}),
    ...(submission.verification ? { verification: submission.verification } : {}),
    pendingReview: true,
  };
  return result;
}

/** Persist before projecting done, so a crash can never leave completion without its SHA. */
export function recordInPlaceResult(...args: Parameters<typeof inPlaceResult>): TaskResult {
  const result = inPlaceResult(...args);
  new CompletionStore(args[0], args[1]).saveResult(result);
  return result;
}

/** Freeze the reviewed sources in a private index; preserve the owner's HEAD, index and files. */
export async function captureInPlaceResult(
  db: AppDb,
  context: ProjectContext,
  task: Task,
  review: C4TaskReview,
  submission: InPlaceSubmission,
): Promise<TaskResult> {
  const root = context.root;
  const before = await context.git.head();
  const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
  const directory = await mkdtemp(join(gitDir, 'skaro-in-place-'));
  const index = join(directory, 'index');
  const env = { GIT_INDEX_FILE: index };
  try {
    await git(root, ['read-tree', before], { env });
    await git(root, ['add', '-A', '--', '.', ':(exclude).skaro'], { env });
    const tree = (await git(root, ['write-tree'], { env })).stdout.trim();
    const changed = await git(root, ['diff-files', '--quiet', '--', '.', ':(exclude).skaro'], {
      env,
      allowFail: true,
    });
    const untracked = await git(
      root,
      ['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ':(exclude).skaro'],
      { env },
    );
    if (changed.code !== 0 || untracked.stdout)
      throw new Error(`${task.id}: sources changed while taking the in-place snapshot`);
    const previousTree = (await git(root, ['rev-parse', `${before}^{tree}`])).stdout.trim();
    const head =
      tree === previousTree
        ? before
        : (
            await git(root, ['commit-tree', tree, '-p', before], {
              input: submission.message ?? `${task.id}: ${task.title}`,
            })
          ).stdout.trim();
    if (
      (await context.git.head()) !== before ||
      review.changeHash !== (await c4ChangeHash(root, review.baseHead))
    )
      throw new Error(`${task.id}: code changed during in-place capture; review C4 again`);
    context.invalidate();
    const artifacts = await context.load();
    const current = artifacts.tasks.find((value) => value.id === task.id);
    if (!current || criteriaRevision(current) !== criteriaRevision(task))
      throw new Error(`${task.id}: acceptance changed during in-place capture`);
    const c4 = { ...review, changeHash: await c4ChangeHash(root, review.baseHead, head) };
    const ref = `refs/skaro/results/${task.id}/${head}`;
    await git(root, ['update-ref', ref, head]);
    return recordInPlaceResult(
      db,
      context.id,
      artifacts,
      task,
      { head, branch: ref, c4 },
      submission,
    );
  } finally {
    await rm(index, { force: true });
    await rm(`${index}.lock`, { force: true });
    await rmdir(directory);
  }
}
