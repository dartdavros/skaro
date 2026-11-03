import { z } from 'zod';
import type { RuntimeJournal } from '../journal.ts';
import type { PathScope } from '../tools/path-scope.ts';
import { evidenceReference } from './schemas.ts';
import {
  verificationReviewSchema,
  verificationCommandHash,
  environmentAssumptions,
} from './environment-review.ts';
import { captureVerificationEnvironment } from './environment.ts';
import { requireEvidence } from './evidence.ts';
import { fingerprint } from './inputs.ts';
import { inspectVerificationHost, type RuntimeVerificationHost } from './host.ts';

export const environmentReviewInput = z.strictObject({
  evidence: z.array(evidenceReference).min(1).max(32),
  assumptions: environmentAssumptions,
});

/** Candidate facts come from real receipts and current measurements, never model-supplied hashes. */
export async function prepareEnvironmentReview(
  raw: unknown,
  scope: PathScope,
  journal: RuntimeJournal,
  host: RuntimeVerificationHost | undefined,
  signal: AbortSignal,
) {
  const input = environmentReviewInput.parse(raw);
  const state = await inspectVerificationHost(journal, scope, host, signal);
  const environment = await captureVerificationEnvironment(journal, signal);
  if (!environment.dependencies)
    throw new Error('Environment review requires declared measured dependencies');
  if (input.assumptions.some((item) => !environment.unresolved.includes(item.concern)))
    throw new Error('Review contains an unknown environment concern');
  const known = new Set(state.criteria.map((item) => item.id));
  const receipts = input.evidence.map((reference) => requireEvidence(journal, reference));
  for (const receipt of receipts) {
    if (
      !receipt.criteria.length ||
      receipt.criteria.some((id) => !known.has(id)) ||
      fingerprint(receipt.environment) !== fingerprint(environment) ||
      fingerprint(receipt.afterEnvironment) !== fingerprint(environment)
    )
      throw new Error('Review evidence is stale or outside the current criteria/environment');
  }
  const selection = {
    criteriaRevision: state.criteriaRevision,
    dependencies: fingerprint(environment.dependencies),
    commands: [
      ...new Set(
        receipts.filter((item) => item.kind === 'command-check').map(verificationCommandHash),
      ),
    ],
    observations: receipts
      .filter((item) => item.kind === 'browser-observation')
      .map((item) => item.source),
    assumptions: input.assumptions,
  };
  const review = verificationReviewSchema.parse({ revision: fingerprint(selection), ...selection });
  return {
    kind: 'owner-environment-review' as const,
    schema: 1,
    review,
    evidence: input.evidence,
    scope: state.binding,
    environment,
    checks: receipts.map((item) =>
      item.kind === 'command-check'
        ? {
            command: item.command,
            cwd: item.cwd,
            shell: item.shell,
            criteria: item.criteria,
            timeoutMs: item.timeoutMs,
          }
        : { observation: item.source, criteria: item.criteria },
    ),
  };
}

export async function recordEnvironmentReview(
  id: string,
  raw: unknown,
  scope: PathScope,
  journal: RuntimeJournal,
  host: RuntimeVerificationHost | undefined,
  signal: AbortSignal,
) {
  const candidate = await prepareEnvironmentReview(raw, scope, journal, host, signal);
  const proposal = journal.find(`environment-review-proposal:${id}`);
  const approval = journal.find(`approval:${id}`);
  const interaction = approval?.facts.find((item) => item.type === 'interaction');
  const answer = journal.state.answered[`approval-${id}`];
  if (
    !proposal ||
    !approval ||
    proposal.sequence >= approval.sequence ||
    fingerprint(proposal.result.value) !== fingerprint(candidate) ||
    interaction?.type !== 'interaction' ||
    interaction.interaction.kind !== 'approval' ||
    interaction.interaction.action.reason !== JSON.stringify(candidate) ||
    answer?.kind !== 'approval' ||
    answer.choice !== 'allow_once'
  )
    throw new Error('Exact current environment assumptions require explicit owner approval');
  await journal.append(`environment-reviewed:${id}`, [], { value: candidate });
  return candidate;
}

export function ownerEnvironmentReviews(journal: Pick<RuntimeJournal, 'records' | 'state'>) {
  const reviews = [];
  for (const record of [...journal.records].reverse()) {
    if (!record.id.startsWith('environment-reviewed:')) continue;
    const id = record.id.slice('environment-reviewed:'.length);
    const answer = journal.state.answered[`approval-${id}`];
    if (answer?.kind !== 'approval' || answer.choice !== 'allow_once') continue;
    const value = record.result.value as { kind?: string; review?: unknown } | undefined;
    if (value?.kind === 'owner-environment-review')
      reviews.push(verificationReviewSchema.parse(value.review));
  }
  return reviews;
}
