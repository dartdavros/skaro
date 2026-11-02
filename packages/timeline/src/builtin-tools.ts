import type { PermissionMode } from './agent.ts';
import type { RouteCapabilityAssessment } from './builtin-model.ts';
import type { SkaroScope } from './skaro-scope.ts';

/** Host-selected files only. Measuring this list does not attest dependency closure. */
export interface BuiltinVerificationDependency {
  id: string;
  path: string;
}

export interface BuiltinToolScope {
  cwd: string;
  readDirs: readonly string[];
  readOnly: boolean;
  artifactDir: string;
  /** Host/build supplies the bundled command supervisor entry. Never a model argument. */
  commandEntry?: string;
  /** Hash of explicit host task variables. Values travel only over private startup/command IPC. */
  commandEnvironmentRevision?: string;
  verificationDependencies?: readonly BuiltinVerificationDependency[];
  /** Explicit owner-reviewed assumptions for exact checks, not measured dependency closure. */
  verificationReview?: BuiltinVerificationReview;
  /** Persisted host binding for authoritative verification tools. */
  verificationScope?: Readonly<SkaroScope>;
  capabilities?: RouteCapabilityAssessment;
}

export interface BuiltinToolResult {
  [key: string]: unknown;
}

export interface BuiltinVerificationReview {
  revision: string;
  criteriaRevision: string;
  dependencies: string;
  commands: readonly string[];
  observations: readonly { name: string; revision: string; argsHash: string }[];
  assumptions: readonly { concern: string; rationale: string }[];
}

export interface BuiltinSandboxStatus {
  verified: false;
  backend: 'unavailable';
  detail: string;
  commandPolicy: 'confirmation-required' | 'owner-full-access';
}

/** A process supervisor is not a filesystem/network sandbox (D-28). */
export function builtinSandboxStatus(mode: PermissionMode): BuiltinSandboxStatus {
  return {
    verified: false,
    backend: 'unavailable',
    detail: 'No verified filesystem/network sandbox backend is configured for the builtin runtime',
    commandPolicy: mode === 'full' ? 'owner-full-access' : 'confirmation-required',
  };
}
