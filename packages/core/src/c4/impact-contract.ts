/** C4-1 metadata contract. No permission or model write is implied by an impact report. */
export interface C4Impact {
  version: 1;
  projectId: string;
  taskId: string;
  runId: string;
  checkout: string;
  baseHead: string;
  changeHash: string;
  scopeHash: string;
  expectedRevision: number;
  requirements: string[];
  elements: string[];
  relationships: string[];
  sources: { path: string; hash: string }[];
  checks: { id: string; fingerprint: string; outcome: 'passed' | 'failed' | 'unknown' }[];
  discrepancies: { source: string; requirement: string; detail: string }[];
}

export type C4Protocol = 'package-v1' | 'impact-v1';
export interface C4ProtocolBinding {
  projectId: string;
  runId: string;
  protocol: C4Protocol;
}

/** Missing legacy binding means legacy, never the project's newly selected default. */
export function c4RunProtocol(
  projectId: string,
  runId: string,
  binding?: C4ProtocolBinding,
): C4Protocol {
  if (!binding) return 'package-v1';
  if (binding.projectId !== projectId || binding.runId !== runId)
    throw new Error('C4 protocol binding belongs to another run');
  if (!['package-v1', 'impact-v1'].includes(binding.protocol))
    throw new Error('Unsupported C4 protocol; execution must remain stopped');
  return binding.protocol;
}

export interface C4ImpactOperation {
  version: 1;
  projectId: string;
  runId: string;
  taskId: string;
  idempotencyKey: string;
  expectedRevision: number;
  /** Immutable existing package, not a replacement model supplied in the report. */
  packageFingerprint: string;
  impactFingerprint: string;
  scopeHash: string;
  changes: {
    group: string;
    id: string;
    operation: 'add' | 'remove' | 'update';
    fields: string[];
  }[];
  review: { elements: string[]; relationships: string[]; requirements: string[] };
  permission: { state: 'pending'; protocol: 'impact-v1' };
}
