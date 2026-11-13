import { C4ValidationError, c4Issue, type AppDb } from '@skaro/core';
import type { ProjectContext } from './projects';
import type { C4TaskReview } from './c4-review';
import { C4SemanticStore } from './c4-semantic-store';
import { c4SemanticSnapshot } from './c4-semantic-snapshot';
import { parseC4SemanticVerdict } from './c4-semantic-result';
import { c4CoverageProblems } from './c4-coverage';
import { inspectC4ReviewCandidate } from './c4-review-candidate';
import { c4ArchitectureHash } from './c4-fingerprint';
import { requireC4ReviewEvidence } from './c4-review-evidence';
import { c4RealizationScopeProblems } from './c4-realization-scope';

/** Completion consumes independent semantics and current physical facts, never the worker's aligned flag. */
export async function inspectSemanticC4Review(
  db: AppDb,
  context: ProjectContext,
  task: string,
  run: string,
): Promise<C4TaskReview> {
  const current = await c4SemanticSnapshot(db, context, task, run, false);
  const job = new C4SemanticStore(db).current(run);
  if (
    !job ||
    job.state !== 'verified' ||
    !job.delivered ||
    job.projectId !== context.id ||
    job.taskId !== task ||
    job.runId !== run ||
    job.fingerprint !== current.fingerprint ||
    !job.verdict ||
    !job.reviewer
  )
    throw new C4ValidationError(
      [
        c4Issue(
          'Current independent C4 verification is required. End this turn so Skaro can verify it.',
          'review_required',
        ),
      ],
      'submission',
    );
  await requireC4ReviewEvidence(job);
  const verdict = parseC4SemanticVerdict(
    JSON.stringify(job.verdict),
    current.fingerprint,
    current.observation,
  );
  if (
    verdict.implementation !== 'aligned' ||
    (verdict.category !== 'aligned' && verdict.category !== 'optional')
  )
    throw new C4ValidationError([c4Issue(verdict.summary, 'review_required')], 'submission');
  const artifacts = await context.store.load();
  if (current.preservation && verdict.realized.length)
    throw new Error('A behavior-preserving move cannot realize planned architecture');
  const review: C4TaskReview = {
    revision: artifacts.c4?.revision ?? 0,
    changeHash: current.observation.impact.changeHash,
    elements: current.observation.scope.elements,
    relationships: current.observation.scope.relationships,
    realized: verdict.realized,
    aligned: true,
    evidence: verdict.summary,
    runId: run,
    baseHead: current.observation.impact.baseHead,
    scope: current.observation.scope,
    modelHash: c4ArchitectureHash(artifacts, current.observation.scope),
    protocol: 'impact-v1',
    semanticReceipt: job.id,
    semanticContextHash: current.contextHash,
    preservation: current.preservation,
  };
  const issues = c4CoverageProblems(
    artifacts,
    task,
    review,
    current.observation.scope,
    !!current.preservation,
  ).map((message) => c4Issue(message));
  issues.push(...c4RealizationScopeProblems(artifacts.c4, review.realized));
  if (!issues.length)
    issues.push(
      ...(await inspectC4ReviewCandidate(
        artifacts.c4,
        review.realized,
        current.observation.impact.checkout,
        review.baseHead,
        current.observation.scope,
      )),
    );
  if (issues.length) throw new C4ValidationError(issues, 'submission');
  if ((await c4SemanticSnapshot(db, context, task, run, false)).fingerprint !== current.fingerprint)
    throw new Error('C4 sources changed during independent review consumption');
  return review;
}
