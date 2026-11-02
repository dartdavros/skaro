import type { RuntimeAcceptancePort, ProcessAdmission } from '@skaro/timeline';
import type { RuntimeJournal } from '../journal.ts';
import { sessionFileScope } from '../tools/session-scope.ts';
import { checkEvidence } from './checks.ts';
import { requireEvidence, type EvidenceReference } from './evidence.ts';
import { captureCheckInputs, fingerprint } from './inputs.ts';
import { captureVerificationEnvironment } from './environment.ts';
import { requirePlannedCheck } from './plans.ts';
import { schemas } from '../tools/schemas.ts';
import { unresolvedVerificationEffects } from './effects.ts';

const inspecting = new WeakMap<RuntimeJournal, Set<string>>();

type InspectionInput = {
  id: string;
  journal: RuntimeJournal;
  host: RuntimeAcceptancePort;
  admission: ProcessAdmission;
  criteriaRevision: string;
  verdicts: readonly { id: string; met: boolean; evidence: readonly EvidenceReference[] }[];
  signal: AbortSignal;
};

/** Preflight only. Only the existing completion service can submit/accept a task. */
export async function inspectVerificationAcceptance(supplied: InspectionInput) {
  const input = {
    ...supplied,
    admission: structuredClone(supplied.admission),
    verdicts: structuredClone(supplied.verdicts),
  };
  const ids = inspecting.get(input.journal) ?? new Set<string>();
  inspecting.set(input.journal, ids);
  if (ids.has(input.id)) throw new Error('Assessment already being inspected');
  ids.add(input.id);
  try {
    return await inspect(input);
  } finally {
    ids.delete(input.id);
  }
}

async function inspect(input: InspectionInput) {
  const { journal, signal } = input;
  const scope = await sessionFileScope(journal);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(input.id)) throw new Error('Invalid assessment identity');
  if (journal.find(`verification-assessment:${input.id}`))
    throw new Error('Assessment already recorded; use a new ID for a fresh inspection');
  if (input.verdicts.length > 128 || input.verdicts.some((item) => item.evidence.length > 32))
    throw new Error('Acceptance proposal exceeds its inspection limit');
  const before = await input.host.inspect(input.admission, signal);
  const reasons = [...before.reasons];
  const unsupported = new Map<string, string>();
  if (journal.state.stopped || journal.state.closed) reasons.push('Runtime session is stopped');
  if (Object.keys(journal.state.interactions).length)
    reasons.push('Runtime interactions remain open');
  if (
    unresolvedVerificationEffects(journal).some(
      ([id, effect]) => id !== input.id || effect.state !== 'pending',
    )
  )
    reasons.push('Runtime effects remain unresolved');
  if (journal.state.config!.sessionId !== input.admission.sessionId)
    reasons.push('Admission does not match the journal session');
  if (!before.binding || before.binding.checkout !== scope.root)
    reasons.push('Evidence checkout does not match the bound task');
  const inputs = await captureCheckInputs(scope, signal);
  const environment = await captureVerificationEnvironment(journal, signal);
  if (before.criteriaRevision !== input.criteriaRevision)
    reasons.push('Criterion revision changed');
  if (before.continuation !== 'allowed') reasons.push(`Continuation is ${before.continuation}`);
  if (before.openDecisions.length) reasons.push('Owner decisions remain open');
  if (!['current', 'not-required'].includes(before.c4)) reasons.push(`C4 is ${before.c4}`);
  const known = new Set(before.criteria.map((item) => item.id));
  if (!known.size) reasons.push('No authoritative acceptance criteria');
  if (new Set(input.verdicts.map((item) => item.id)).size !== input.verdicts.length)
    reasons.push('Duplicate criterion verdict');
  if (input.verdicts.some((item) => !known.has(item.id))) reasons.push('Unknown criterion ID');
  for (const criterion of known) {
    const verdict = input.verdicts.find((item) => item.id === criterion);
    if (!verdict?.met || !verdict.evidence.length) {
      const reason = `Criterion lacks a supported positive verdict: ${criterion}`;
      reasons.push(reason);
      unsupported.set(criterion, reason);
      continue;
    }
    for (const reference of verdict.evidence) {
      try {
        const evidence = requireEvidence(journal, reference);
        const binding = journal.state.config!.tools?.verificationScope;
        if (binding && evidence.kind === 'command-check') {
          if (!evidence.plan) reasons.push('Bound task evidence has no verification plan');
          else
            await requirePlannedCheck(
              schemas.run_check.parse({
                name: evidence.name,
                criteria: evidence.criteria,
                command: evidence.command,
                cwd: evidence.cwd,
                shell: evidence.shell,
                timeoutMs: evidence.timeoutMs,
                plan: evidence.plan,
              }),
              evidence.cwd,
              scope,
              journal,
              { scope: binding, acceptance: input.host, admission: input.admission },
              signal,
            );
        }
        if (
          !evidence.criteria.includes(criterion) ||
          evidence.criteria.some((id) => !known.has(id))
        )
          reasons.push('Evidence criterion mapping is not authoritative');
        const state = await checkEvidence(reference, scope, journal, signal);
        if (
          !state.inputsCurrent ||
          !state.outputCurrent ||
          !state.environmentCurrent ||
          ('artifactsCurrent' in state &&
            (!state.artifactsCurrent || !state.sourceCurrent || !state.latestObservation))
        )
          reasons.push('Evidence is missing or stale');
        if (!['passed', 'observed'].includes(state.outcome))
          reasons.push('Evidence has no successful outcome');
        if (state.unresolved.length)
          reasons.push('Evidence environment/dependencies require review');
        if (
          state.environmentReview &&
          state.environmentReview.criteriaRevision !== before.criteriaRevision
        )
          reasons.push('Host environment review criterion revision changed');
      } catch {
        signal.throwIfAborted();
        reasons.push('Invalid or unavailable evidence reference');
      }
    }
  }
  const after = await input.host.inspect(input.admission, signal);
  signal.throwIfAborted();
  if (fingerprint(before) !== fingerprint(after))
    reasons.push('Acceptance state changed during inspection');
  if (
    fingerprint(inputs) !== fingerprint(await captureCheckInputs(scope, signal)) ||
    fingerprint(environment) !== fingerprint(await captureVerificationEnvironment(journal, signal))
  )
    reasons.push('Evidence inputs or environment changed during inspection');
  const result = {
    kind: 'verification-assessment',
    schema: 1,
    readyToSubmit: reasons.length === 0,
    hostRevision: after.revision,
    criteriaRevision: after.criteriaRevision,
    verdicts: structuredClone(input.verdicts),
    reasons: [...new Set(reasons)],
    unsupportedCriteria: [...unsupported.keys()],
    blockingReasons: [
      ...new Set(reasons.filter((reason) => ![...unsupported.values()].includes(reason))),
    ],
  };
  await journal.append(
    `verification-assessment:${input.id}`,
    [],
    { value: result },
    fingerprint({
      criteriaRevision: input.criteriaRevision,
      verdicts: input.verdicts,
      hostRevision: before.revision,
    }),
  );
  return result;
}
