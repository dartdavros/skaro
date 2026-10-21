import { dirname } from 'node:path';
import { background } from './background/client';
import { validateC4Code, realizeC4, validateC4Model, git, type AppDb } from '@skaro/core';
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
    db.setSetting(c4ReviewKey(context.id, taskId), review);
    return review;
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
    const realized = realizeC4(artifacts.c4, review.realized);
    if (review.realized.length) problems.push(...validateC4Model(realized));
    problems.push(
      ...(await validateC4Code(checkout, {
        ...realized,
        elements: realized.elements.filter((item) => scope.elements.includes(item.id)),
      })),
    );
  }
  if (problems.length) throw new Error(problems.join('\n'));
  return review;
}
