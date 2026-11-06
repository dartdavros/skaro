import { git, C4ValidationError, c4Issue, type AppDb } from '@skaro/core';
import type { ReviewC4Args, SkaroScope, ToolResult } from '@skaro/mcp-server';
import type { ProjectContext } from './projects';
import { c4ArchitectureHash, c4ChangeHash, c4ReviewKey } from './c4-fingerprint';
import { c4CoverageProblems } from './c4-coverage';
import { inspectC4ReviewCandidate } from './c4-review-candidate';
import { readTaskC4Scope, reviewedTaskScope } from './c4-task-scope';
import type { C4TaskReview } from './c4-review';

/** A saved review certifies preflight as well as coverage, without publishing architecture. */
export async function writeC4TaskReview(
  db: AppDb,
  context: ProjectContext,
  checkout: string,
  args: ReviewC4Args,
  scope: SkaroScope,
  pendingPackage: () => Promise<boolean>,
): Promise<ToolResult> {
  db.setSetting(c4ReviewKey(context.id, scope.taskId!), null);
  context.invalidate();
  const artifacts = await context.load();
  const baseHead = (await git(checkout, ['rev-parse', artifacts.config.baseBranch])).stdout.trim();
  const taskScope = await readTaskC4Scope(checkout, baseHead, artifacts, scope.taskId!);
  const reviewedScope = reviewedTaskScope(taskScope, args, artifacts.c4);
  const issues = c4CoverageProblems(artifacts, scope.taskId!, args, taskScope).map((message) =>
    c4Issue(message),
  );
  if (args.changeHash !== (await c4ChangeHash(checkout, baseHead)))
    issues.push(c4Issue('Code changed since context was read.', 'stale_review'));
  if (await pendingPackage())
    issues.push(
      c4Issue('A required task architecture package is still pending.', 'pending_package'),
    );
  // Coverage errors can contain unknown IDs. Report those before constructing a candidate.
  if (!issues.length)
    issues.push(
      ...(await inspectC4ReviewCandidate(
        artifacts.c4,
        args.realized,
        checkout,
        baseHead,
        reviewedScope,
      )),
    );
  if (issues.length) throw new C4ValidationError(issues, 'review');
  // File checks await I/O; never save an already stale successful review.
  context.invalidate();
  const after = await context.load();
  if (
    args.changeHash !== (await c4ChangeHash(checkout, baseHead)) ||
    JSON.stringify(artifacts.c4) !== JSON.stringify(after.c4) ||
    c4ArchitectureHash(artifacts, reviewedScope) !== c4ArchitectureHash(after, reviewedScope) ||
    (await pendingPackage())
  )
    throw new C4ValidationError(
      [
        c4Issue(
          'Code or architecture changed during C4 preflight; read context and review again.',
          'stale_review',
        ),
      ],
      'review',
    );
  const review: C4TaskReview = {
    ...args,
    baseHead,
    modelHash: c4ArchitectureHash(artifacts, reviewedScope),
    scope: reviewedScope,
    runId: scope.runId!,
  };
  db.setSetting(c4ReviewKey(context.id, scope.taskId!), review);
  return {
    text:
      taskScope.kind === 'artifacts'
        ? 'Artifact-only changes confirmed from Git; implementation/publication preflight is not applicable and no planned architecture is realized.'
        : 'C4 review saved: coverage, future publication model and task code paths passed preflight for this exact fingerprint. Nothing is published. submit_result rechecks the candidate and fingerprints; the assembled Git candidate is checked again at publication.',
    structuredContent: {
      revision: review.revision,
      changeHash: review.changeHash,
      preflight: taskScope.kind === 'artifacts' ? 'not_applicable' : 'passed',
      published: false,
    },
  };
}
