import type { RuntimeAcceptanceState } from '@skaro/timeline';
import type { RuntimeJournal } from '../journal.ts';
import { sessionFileScope } from '../tools/session-scope.ts';
import { checkEvidence } from './checks.ts';
import type { EvidenceReference } from './evidence.ts';
import { fingerprint } from './inputs.ts';
import { unresolvedVerificationEffects } from './effects.ts';

export interface RecordedAssessment {
  kind: 'verification-assessment';
  schema: 1;
  readyToSubmit: boolean;
  hostRevision: string;
  criteriaRevision: string;
  reasons: string[];
  unsupportedCriteria?: string[];
  blockingReasons?: string[];
  verdicts: { id: string; met: boolean; evidence: EvidenceReference[] }[];
}

/** Pure authority/coverage gate, shared by the real primary reader and DTO contract tests. */
export function requireSubmissionAssessment(
  value: RecordedAssessment | undefined,
  host: RuntimeAcceptanceState,
  claimedIds: readonly string[] = host.criteria.map((item) => item.id),
) {
  const ids = host.criteria.map((item) => item.id);
  const completing = claimedIds.length === ids.length;
  if (
    !value ||
    value.kind !== 'verification-assessment' ||
    value.schema !== 1 ||
    typeof value.readyToSubmit !== 'boolean' ||
    !Array.isArray(value.reasons) ||
    (completing && (!value.readyToSubmit || value.reasons.length)) ||
    (!completing &&
      (!Array.isArray(value.blockingReasons) ||
        value.blockingReasons.length ||
        !Array.isArray(value.unsupportedCriteria) ||
        value.unsupportedCriteria.some((id) => !ids.includes(id) || claimedIds.includes(id)))) ||
    value.hostRevision !== host.revision ||
    value.criteriaRevision !== host.criteriaRevision ||
    host.continuation !== 'allowed' ||
    !['current', 'not-required'].includes(host.c4) ||
    host.reasons.length ||
    host.openDecisions.length ||
    host.binding?.execution !== 'allowed'
  )
    throw new Error('A fresh successful authoritative verification assessment is required');
  if (
    !ids.length ||
    !claimedIds.length ||
    new Set(claimedIds).size !== claimedIds.length ||
    claimedIds.some((id) => !ids.includes(id)) ||
    !Array.isArray(value.verdicts) ||
    new Set(value.verdicts.map((item) => item.id)).size !== value.verdicts.length ||
    value.verdicts.some((item) => !ids.includes(item.id)) ||
    claimedIds.some((id) => {
      const verdict = value.verdicts.find((item) => item.id === id);
      return !verdict?.met || !verdict.evidence.length;
    })
  )
    throw new Error('Every claimed authoritative criterion needs current positive evidence');
  return value.verdicts.filter((item) => claimedIds.includes(item.id));
}

/** Read the genuine assessment and remeasure each receipt immediately before completion mutation. */
export async function requireRecordedSubmission(
  journal: Pick<RuntimeJournal, 'records' | 'state'>,
  host: RuntimeAcceptanceState,
  signal: AbortSignal,
  claimedIds?: readonly string[],
) {
  if (
    journal.state.stopped ||
    journal.state.closed ||
    Object.keys(journal.state.interactions).length
  )
    throw new Error('The builtin task session is stopped or awaiting a decision');
  const unresolved = unresolvedVerificationEffects(journal);
  if (
    unresolved.length > 1 ||
    unresolved.some(
      ([id, effect]) =>
        effect.state !== 'pending' ||
        journal.state.toolRequests[id]?.name !== 'mcp__skaro__submit_result',
    )
  )
    throw new Error('Unresolved runtime effects prevent submission');
  const record = journal.records.findLast((item) => item.id.startsWith('verification-assessment:'));
  const assessment = record?.result.value as RecordedAssessment | undefined;
  const selected = requireSubmissionAssessment(assessment, host, claimedIds);
  if (
    record!.result.error ||
    record!.requestHash !==
      fingerprint({
        criteriaRevision: assessment!.criteriaRevision,
        verdicts: assessment!.verdicts,
        hostRevision: assessment!.hostRevision,
      })
  )
    throw new Error('The recorded verification assessment is not a successful bound inspection');
  const scope = await sessionFileScope(journal);
  for (const verdict of selected)
    for (const reference of verdict.evidence) {
      signal.throwIfAborted();
      const evidence = await checkEvidence(reference, scope, journal, signal);
      if (
        !evidence.inputsCurrent ||
        !evidence.outputCurrent ||
        !evidence.environmentCurrent ||
        !evidence.criteria.includes(verdict.id) ||
        !['passed', 'observed'].includes(evidence.outcome) ||
        evidence.unresolved.length ||
        (evidence.environmentReview &&
          evidence.environmentReview.criteriaRevision !== host.criteriaRevision) ||
        ('artifactsCurrent' in evidence &&
          (!evidence.artifactsCurrent || !evidence.sourceCurrent || !evidence.latestObservation))
      )
        throw new Error('Builtin submission evidence is missing, stale or not reviewed');
    }
  return { sequence: record!.sequence, hash: record!.hash };
}
