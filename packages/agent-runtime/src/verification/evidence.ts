import type { RuntimeJournal } from '../journal.ts';
import type { CheckInputs } from './inputs.ts';
import type { captureCheckEnvironment } from './environment.ts';

export interface EvidenceReference {
  sequence: number;
  hash: string;
}
export interface CheckEvidence {
  kind: 'command-check';
  schema: 1;
  id: string;
  name: string;
  criteria: string[];
  command: string;
  cwd: string;
  shell: string;
  timeoutMs?: number;
  inputs: CheckInputs;
  after: CheckInputs;
  environment: Awaited<ReturnType<typeof captureCheckEnvironment>>;
  afterEnvironment?: Awaited<ReturnType<typeof captureCheckEnvironment>>;
  startedAt: number;
  finishedAt: number;
  outcome: 'passed' | 'failed' | 'infrastructure-error' | 'inputs-changed' | 'environment-changed';
  exitCode: number | null;
  output: { path: string; sha256: string; bytes: number };
  retryOf?: EvidenceReference;
  plan?: EvidenceReference & { stepId: string };
}
export interface BrowserEvidence extends Omit<
  CheckEvidence,
  'kind' | 'command' | 'shell' | 'exitCode' | 'retryOf' | 'outcome'
> {
  kind: 'browser-observation';
  source: { name: string; revision: string; argsHash: string };
  outcome: 'observed' | 'tool-error' | 'inputs-changed' | 'environment-changed';
  artifacts: { path: string; sha256: string; bytes: number }[];
}
export function requireEvidence(
  journal: Pick<RuntimeJournal, 'records'>,
  reference: EvidenceReference,
): CheckEvidence | BrowserEvidence {
  const record = journal.records[reference.sequence - 1];
  if (!record || record.hash !== reference.hash || !record.id.endsWith(':result'))
    throw new Error('Unknown verification evidence reference');
  const value = record.result.value as CheckEvidence | BrowserEvidence;
  if (
    value?.schema !== 1 ||
    !(
      (record.id === `check:${value.id}:result` && value.kind === 'command-check') ||
      (record.id === `observation:${value.id}:result` && value.kind === 'browser-observation')
    )
  )
    throw new Error('Unsupported verification evidence');
  return value;
}
export function requireCheckEvidence(
  journal: Pick<RuntimeJournal, 'records'>,
  reference: EvidenceReference,
): CheckEvidence {
  const value = requireEvidence(journal, reference);
  if (value.kind !== 'command-check') throw new Error('Diagnosis/retry requires command evidence');
  return value;
}
