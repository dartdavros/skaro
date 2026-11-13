/** Owner-only local deployment contract. No remote target or Git publication is implied. */
export interface LocalVersionTarget {
  id: string;
  projectId: string;
  resourceId: string;
  composeFile: string;
  codeVariable: string;
  variables: Record<string, string>;
  ready: string;
  dataVersion: string;
  /** Required when the target has writable persistent mounts. Both use its permanent directory. */
  checkpoint?: string;
  restore?: string;
  revision: string;
  configuration?: string;
}
export interface LocalVersionReceipt {
  id: string;
  targetId: string;
  manifestId: string;
  release: string;
  previous: string;
  state: 'prepared' | 'installing' | 'verified' | 'rollback_required' | 'rolled_back';
  head: string;
  tree: string;
  dataVersion: string;
  dataFingerprint: string;
  checkpointCompleted: boolean;
  wasRunning: boolean;
  targetContract: string;
  previousConfiguration: string;
  previousImages: Record<string, string>;
}
export interface LocalVersionMethods {
  'local.register': (
    projectId: string,
    target: Omit<LocalVersionTarget, 'projectId' | 'revision'>,
  ) => Promise<LocalVersionTarget>;
  'local.install': (
    projectId: string,
    targetId: string,
    manifestId: string,
    expectedRevision: string,
  ) => Promise<LocalVersionReceipt>;
  'local.rollback': (projectId: string, receiptId: string) => Promise<LocalVersionReceipt>;
  'local.prepareCandidate': (
    projectId: string,
    taskId: string,
    head: string,
    inputs: string,
  ) => Promise<{ id: string; state: string }>;
  'local.candidate': (
    projectId: string,
    integrationId: string,
  ) => Promise<{ id: string; head: string; inputs: string }>;
}
