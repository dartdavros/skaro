import { dirname } from 'node:path';
import { taskC4Protocol } from './c4-protocol';
import { inspectSemanticC4Review } from './c4-semantic-gate';
import { c4PackageBlocks } from './c4-package-policy';
import { background } from './background/client';
import { C4ValidationError, c4Issue, git, type AppDb } from '@skaro/core';
import { inspectC4ReviewCandidate } from './c4-review-candidate';
import type { ReviewC4Args } from '@skaro/mcp-server';
import type { ProjectContext } from './projects';
import { c4CoverageProblems } from './c4-coverage';
export { c4CoverageProblems } from './c4-coverage';
import { readTaskC4Scope, reviewedTaskScope, type C4TaskScope } from './c4-task-scope';

export interface C4TaskReview extends ReviewC4Args {
  runId: string;
  baseHead: string;
  modelHash: string;
  scope?: C4TaskScope;
  protocol?: import('@skaro/core').C4Protocol;
  semanticReceipt?: string;
  semanticContextHash?: string;
  preservation?: import('./c4-preservation').C4Preservation;
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
  if (inspected.artifactOnly && inspected.review.protocol !== 'impact-v1')
    db.setSetting(c4ReviewKey(context.id, taskId), inspected.review);
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
  const run = runId ?? db.latestRun(context.id, taskId)?.id;
  const impact = !!run && taskC4Protocol(db, context.id, run) === 'impact-v1';
  const packages = await background(dirname(db.filePath), 'c4.list', context.id, taskId);
  if (
    packages.some(
      (p) =>
        p.package.task?.id === taskId &&
        (impact ? c4PackageBlocks(db, p, run!) : ['pending', 'accepted'].includes(p.item.state)),
    )
  )
    throw new C4ValidationError(
      [c4Issue('A task architecture package is still pending.', 'pending_package')],
      'submission',
    );
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
      ...(impact ? { protocol: 'impact-v1' as const } : {}),
    };
    return { review, artifactOnly: true };
  }
  const review = db.getSetting<C4TaskReview | null>(c4ReviewKey(context.id, taskId), null);
  if (impact)
    return {
      review: await inspectSemanticC4Review(db, context, taskId, run!),
      artifactOnly: false,
    };
  if (review?.protocol && review.protocol !== 'package-v1')
    throw new C4ValidationError(
      [c4Issue('C4 review belongs to another protocol.', 'stale_review')],
      'submission',
    );
  if (!review || (runId && review.runId !== runId))
    throw new C4ValidationError(
      [
        c4Issue(
          `${taskId}: call review_c4 with code evidence before submitting the result`,
          'review_required',
        ),
      ],
      'submission',
    );
  const scope = reviewedTaskScope(actualScope, review, artifacts.c4);
  const issues = c4CoverageProblems(
    artifacts,
    taskId,
    review.scope ? { ...review, revision: artifacts.c4?.revision ?? review.revision } : review,
    actualScope,
  ).map((message) => c4Issue(message));
  if (review.modelHash !== c4ArchitectureHash(artifacts, review.scope ? scope : undefined))
    issues.push(c4Issue('Architecture or its documents changed after review.', 'stale_review'));
  if (review.changeHash !== (await c4ChangeHash(checkout, review.baseHead)))
    issues.push(c4Issue('Code changed after C4 review; review it again.', 'stale_review'));
  issues.push(
    ...(await inspectC4ReviewCandidate(artifacts.c4, review.realized, checkout, baseHead, scope)),
  );
  if (issues.length) throw new C4ValidationError(issues, 'submission');
  return { review, artifactOnly: false };
}
