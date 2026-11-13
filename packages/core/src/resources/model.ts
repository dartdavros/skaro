export type ResourceKind = 'worktree' | 'environment' | 'cache';
export interface ResourceIdentity {
  /** Absolute canonical path; the caller must verify realpath before a destructive action. */
  path?: string;
  composeProject?: string;
}
export interface ResourceOwner {
  kind: 'project' | 'task' | 'integration' | 'unknown';
  id: string;
}
/** Observed consumers only. RC-1 does not implement admission or expiring leases. */
export interface ResourceConsumer {
  id: string;
  kind: 'agent' | 'verification' | 'integration' | 'copy' | 'preview' | 'unknown';
  generation: number;
}
export interface ResourceSource {
  declarationRevision?: string | number;
  commit?: string;
  dataVersion?: string;
  /** Reference to the recovery contract, never credentials or command output. */
  recovery?: string;
}
export interface ResourceRegistration {
  projectId: string;
  kind: ResourceKind;
  identity: ResourceIdentity;
  owner: ResourceOwner;
  purpose: 'project-dev' | 'task' | 'integration' | 'worktree' | 'cache' | 'unknown';
  ownership: 'registered' | 'legacy-unverified';
  preservation: 'disposable' | 'reproducible' | 'persistent' | 'unique' | 'unknown';
  generation: number;
  consumers: ResourceConsumer[];
  state: 'available' | 'retained' | 'released' | 'error';
  /** Observed Docker object IDs are evidence of this generation, not stable resource identity. */
  objectIds?: string[];
  source?: ResourceSource;
}
export interface ResourceRecord extends ResourceRegistration {
  id: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  lastOutcome?: ResourceOutcome;
}
/** Classification and ownership require explicit adoption, not an observational update. */
export type ResourcePatch = Partial<
  Pick<ResourceRegistration, 'consumers' | 'objectIds' | 'source' | 'state' | 'generation'>
>;
export interface ResourceOutcomeInput {
  operationId: string;
  resourceId: string;
  generation: number;
  action: 'inspect' | 'migrate' | 'stop' | 'remove';
  state: 'observed' | 'retained' | 'failed' | 'stopped' | 'released';
  /** Stable machine code only: raw errors can contain secrets. */
  reason: string;
  relatedIds?: string[];
  freedBytes?: number;
}
export interface ResourceOutcome extends ResourceOutcomeInput {
  at: number;
}
