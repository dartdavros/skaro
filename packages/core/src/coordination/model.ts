/** Metadata only. Arguments, prompts, secrets and raw errors stay in their existing stores. */
export interface CoordinationSource {
  kind: 'owner' | 'worker' | 'controller';
  id: string;
}
/** References are local to the enclosing project, never authority to access another project. */
export interface CoordinationRef {
  kind:
    | 'command'
    | 'task'
    | 'chat'
    | 'run'
    | 'integration'
    | 'resource'
    | 'document'
    | 'decision'
    | 'blocker';
  id: string;
  version?: string | number;
}
export interface CoordinationEvidence {
  code: string;
  refs: CoordinationRef[];
  fingerprint?: string;
}
export interface ProjectCoordinator {
  id: string;
  projectId: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}
export interface CoordinationEventInput {
  id: string;
  projectId: string;
  kind: string;
  source: CoordinationSource;
  subject: CoordinationRef;
  causationId?: string;
  inputHash: string;
}
export interface CoordinationIntentInput {
  id: string;
  projectId: string;
  eventId: string;
  source: CoordinationSource;
  action: string;
  subject: CoordinationRef;
  inputHash: string;
}
export interface CoordinationOperationInput {
  id: string;
  projectId: string;
  eventId: string;
  intentId: string;
  idempotencyKey: string;
  action: string;
  subject: CoordinationRef;
  scopeKey: string;
  mode: 'mutation' | 'delivery' | 'control' | 'observation';
  expectedVersion?: number;
  inputHash: string;
}
export interface CoordinationMetadata {
  revision: number;
  createdAt: number;
  updatedAt: number;
}
export type CoordinationEvent = CoordinationEventInput & { createdAt: number };
export type CoordinationIntent = CoordinationIntentInput & { createdAt: number };
export type CoordinationOperationState =
  'queued' | 'dispatching' | 'succeeded' | 'failed' | 'uncertain' | 'rejected';
export interface CoordinationOperation extends CoordinationOperationInput, CoordinationMetadata {
  state: CoordinationOperationState;
  claimId?: string;
  evidence?: CoordinationEvidence;
}
export interface CoordinationRequest {
  event: CoordinationEventInput;
  intent: CoordinationIntentInput;
  operation: CoordinationOperationInput;
}
export interface CoordinationCompletion {
  expectedRevision: number;
  claimId: string;
  state: 'succeeded' | 'failed' | 'uncertain';
  evidence: CoordinationEvidence;
}
export interface CoordinationDecisionInput {
  id: string;
  projectId: string;
  eventId: string;
  operationId?: string;
  kind: 'question' | 'approval';
  subject: CoordinationRef;
  inputHash: string;
}
export interface CoordinationDecision extends CoordinationDecisionInput, CoordinationMetadata {
  state: 'pending' | 'answered' | 'denied' | 'cancelled';
  evidence?: CoordinationEvidence;
}
export type CoordinationBlockerCategory =
  | 'dependency'
  | 'environment'
  | 'resource'
  | 'permission'
  | 'owner-decision'
  | 'secret'
  | 'quota'
  | 'budget'
  | 'authentication'
  | 'external'
  | 'no-progress';
export interface CoordinationBlockerInput {
  protocol?: import('./incidents.ts').IncidentProtocol;
  id: string;
  projectId: string;
  eventId: string;
  category: CoordinationBlockerCategory;
  subject: CoordinationRef;
  inputHash: string;
  resolution: CoordinationEvidence;
  subscribers: CoordinationRef[];
}
export interface CoordinationBlocker extends CoordinationBlockerInput, CoordinationMetadata {
  state: 'open' | 'resolved' | 'cancelled';
  evidence?: CoordinationEvidence;
}
