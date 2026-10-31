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
}
export function requireCheckEvidence(
  journal: RuntimeJournal,
  reference: EvidenceReference,
): CheckEvidence {
  const record = journal.records[reference.sequence - 1];
  if (
    !record ||
    record.hash !== reference.hash ||
    !record.id.startsWith('check:') ||
    !record.id.endsWith(':result')
  )
    throw new Error('Unknown verification evidence reference');
  const value = record.result.value as CheckEvidence;
  if (value?.kind !== 'command-check' || value.schema !== 1)
    throw new Error('Unsupported verification evidence');
  return value;
}
