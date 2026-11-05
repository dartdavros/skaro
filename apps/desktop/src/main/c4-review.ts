import { dirname } from 'node:path';
import { background } from './background/client';
import { validateC4Model, git, type AppDb } from '@skaro/core';
import { candidateC4Model } from './c4-candidate';
import { validateC4TaskCode } from './c4-task-code';
import type { ReviewC4Args } from '@skaro/mcp-server';
import type { ProjectContext } from './projects';
import { c4CoverageProblems } from './c4-coverage';
export { c4CoverageProblems } from './c4-coverage';
import { readTaskC4Scope, reviewedC4Ids, type C4TaskScope } from './c4-task-scope';

export interface C4TaskReview extends ReviewC4Args {
  runId: string;
  baseHead: string;
  modelHash: string;
  scope?: C4TaskScope;
}
import { c4ArchitectureHash, c4ChangeHash, c4ReviewKey } from './c4-fingerprint';
export { c4ArchitectureHash, c4ChangeHash, c4ReviewKey } from './c4-fingerprint';

export async function assertC4TaskReview(
  db: AppDb,
  context: ProjectContext,
  taskId: string,
  checkout: string,
  runId?: string,
): Promise<C4TaskReview> {
  const inspected = await inspectC4TaskReviewData(db, context, taskId, checkout, runId);
  if (inspected.artifactOnly) db.setSetting(c4ReviewKey(context.id, taskId), inspected.review);
  return inspected.review;
}

/** Same validation as submission, without recording an artifact-only review. */
export async function inspectC4TaskReview(
  db: AppDb,
  context: ProjectContext,
  taskId: string,
  checkout: string,
  runId?: string,
): Promise<C4TaskReview> {
  return (await inspectC4TaskReviewData(db, context, taskId, checkout, runId)).review;
}

async function inspectC4TaskReviewData(
  db: AppDb,
  context: ProjectContext,
  taskId: string,
  checkout: string,
  runId?: string,
): Promise<{ review: C4TaskReview; artifactOnly: boolean }> {
  context.invalidate();
  const artifacts = await context.load();
  const baseHead = (await git(checkout, ['rev-parse', artifacts.config.baseBranch])).stdout.trim();
  const actualScope = await readTaskC4Scope(checkout, baseHead, artifacts, taskId);
  const packages = await background(dirname(db.filePath), 'c4.list', context.id, taskId);
  if (
    packages.some(
      (p) => p.package.task?.id === taskId && ['pending', 'accepted'].includes(p.item.state),
    )
  )
    throw new Error('A task architecture package is still pending.');
  if (actualScope.kind === 'artifacts') {
    const review: C4TaskReview = {
      revision: artifacts.c4?.revision ?? 0,
      elements: [],
      relationships: [],
      realized: [],
      aligned: true,
      evidence: `Artifact-only Git changes; implementation review is not applicable: ${actualScope.files.join(', ')}`,
      changeHash: await c4ChangeHash(checkout, baseHead),
      baseHead,
      scope: actualScope,
      runId: runId ?? 'artifacts',
      modelHash: c4ArchitectureHash(artifacts, actualScope),
    };
    return { review, artifactOnly: true };
  }
  const review = db.getSetting<C4TaskReview | null>(c4ReviewKey(context.id, taskId), null);
  if (!review || (runId && review.runId !== runId))
    throw new Error(`${taskId}: call review_c4 with code evidence before submitting the result`);
  const scope = {
    ...actualScope,
    elements: [...reviewedC4Ids(actualScope, review, artifacts.c4)].filter((id) =>
      artifacts.c4?.elements.some((item) => item.id === id),
    ),
    relationships: [...reviewedC4Ids(actualScope, review, artifacts.c4)].filter((id) =>
      artifacts.c4?.relationships.some((item) => item.id === id),
    ),
  };
  const problems = c4CoverageProblems(
    artifacts,
    taskId,
    review.scope ? { ...review, revision: artifacts.c4?.revision ?? review.revision } : review,
    actualScope,
  );
  if (review.modelHash !== c4ArchitectureHash(artifacts, review.scope ? scope : undefined))
    problems.push('Architecture or its documents changed after review.');
  if (review.changeHash !== (await c4ChangeHash(checkout, review.baseHead)))
    problems.push('Code changed after C4 review; review it again.');
  if (artifacts.c4) {
    const realized = await candidateC4Model(artifacts.c4, review.realized, {
      root: checkout,
      base: baseHead,
    });
    if (review.realized.length) problems.push(...validateC4Model(realized));
    problems.push(
      ...(await validateC4TaskCode(
        checkout,
        baseHead,
        {
          ...realized,
          elements: realized.elements.filter((item) => scope.elements.includes(item.id)),
        },
        actualScope.files,
        review.realized,
      )),
    );
  }
  if (problems.length) throw new Error(problems.join('\n'));
  return { review, artifactOnly: false };
}
