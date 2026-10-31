import type { RuntimeJournal } from '../journal.ts';
import type { ToolArgs } from '../tools/schemas.ts';
import { fingerprint } from './inputs.ts';
import { requireCheckEvidence, type EvidenceReference } from './evidence.ts';

/** A diagnosis is a model hypothesis, not an owner decision or a successful check. */
export function recordCheckDiagnosis(
  id: string,
  input: ToolArgs<'diagnose_check'>,
  journal: RuntimeJournal,
) {
  const failed = requireCheckEvidence(journal, input.evidence);
  if (failed.outcome === 'passed') throw new Error('Diagnosis requires a failed check');
  return journal
    .append(`check-diagnosis:${id}`, [], {
      value: {
        kind: 'check-diagnosis',
        schema: 1,
        origin: 'model',
        ...input,
        notice: 'Hypothesis only; the original outcome and acceptance gates remain unchanged',
      },
    })
    .then((record) => ({ diagnosis: { sequence: record.sequence, hash: record.hash } }));
}

export function requireCheckRetry(
  input: ToolArgs<'run_check'>,
  cwd: string,
  journal: RuntimeJournal,
) {
  if (!input.retryOf) return;
  const failed = requireCheckEvidence(journal, input.retryOf);
  if (failed.outcome === 'passed')
    throw new Error('A successful check is not a failed retry source');
  const diagnosed = journal.records.some((record) => {
    const value = record.result.value as
      { kind?: string; evidence?: EvidenceReference } | undefined;
    return (
      record.id.startsWith('check-diagnosis:') &&
      value?.kind === 'check-diagnosis' &&
      fingerprint(value.evidence) === fingerprint(input.retryOf)
    );
  });
  if (!diagnosed) throw new Error('Retry requires a recorded diagnosis of this failure');
  if (
    input.command !== failed.command ||
    (input.shell ?? 'powershell') !== failed.shell ||
    cwd !== failed.cwd ||
    input.timeoutMs !== failed.timeoutMs ||
    input.name !== failed.name ||
    fingerprint([...input.criteria].sort()) !== fingerprint([...failed.criteria].sort())
  )
    throw new Error('Retry must preserve command, cwd, shell, timeout and criterion coverage');
}
