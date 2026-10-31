import type { PermissionMode } from './agent.ts';
import type { RouteCapabilityAssessment } from './builtin-model.ts';

export interface BuiltinToolScope {
  cwd: string;
  readDirs: readonly string[];
  readOnly: boolean;
  artifactDir: string;
  /** Host/build supplies the bundled command supervisor entry. Never a model argument. */
  commandEntry?: string;
  capabilities?: RouteCapabilityAssessment;
}

export interface BuiltinToolResult {
  [key: string]: unknown;
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
