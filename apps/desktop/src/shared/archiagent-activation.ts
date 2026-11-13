import type { C4Protocol } from '@skaro/core';
import type { CoordinatorDispatchState } from './coordination-control';

export interface ArchiagentActivation {
  version: 1;
  revision: number;
  coordinatorId: string;
  protocol: C4Protocol;
  schemaVersion: number;
  features: { coordination: 1; resources: 1; c4: 1 };
  requestId: string;
  requestHash: string;
  eligibility: string;
  dispatchRevision: number;
}
export interface ArchiagentActivationExpected {
  dispatchRevision: number;
  activationRevision: number;
  protocol: C4Protocol;
  eligibility: string;
}
export interface ArchiagentStatus {
  dispatch: CoordinatorDispatchState;
  activation?: ArchiagentActivation;
  protocol: C4Protocol;
  eligibility: string;
  compatible: boolean;
  reason?: string;
  pinnedRuns: { legacy: number; impact: number };
  packages: { pending: number; accepted: number; terminal: number };
}
export interface ArchiagentActivationMethods {
  'archiagent.status': (projectId: string) => ArchiagentStatus;
  'archiagent.activate': (
    projectId: string,
    protocol: C4Protocol,
    expected: ArchiagentActivationExpected,
    requestId: string,
  ) => ArchiagentStatus;
}
