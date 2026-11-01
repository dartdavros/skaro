import type { PermissionMode } from './agent.ts';
import type { TimelineEvent } from './model.ts';
import type { SkaroScope } from './skaro-scope.ts';
import type { CredentialPort } from './builtin-credentials.ts';
import type { BuiltinContractVersions } from './builtin-version.ts';

export interface RuntimeProcessIdentity {
  pid: number;
  birth: string;
  platform: string;
}

/** Host-owned revocable lease, verified at each boundary, not a sandbox claim. */
export interface ProcessAdmission {
  id: string;
  sessionId: string;
  generation: number;
}

export interface ProcessAdmissionPort {
  /** Persists OS ownership before returning permission to act. Aborted startup never admits. */
  admit(identity: RuntimeProcessIdentity, signal: AbortSignal): Promise<ProcessAdmission>;
  requireActive(admission: ProcessAdmission, signal: AbortSignal): Promise<void>;
  revoke(admission: ProcessAdmission, reason: string): Promise<void>;
  /** Resolves only after host confirms exit of the owned process tree. */
  confirmExit(admission: ProcessAdmission): Promise<void>;
}

export interface ScopedOperationPort {
  /** Existing MCP tool schemas/availability and handlers, bound to host.scope. */
  catalog(
    admission: ProcessAdmission,
    signal: AbortSignal,
  ): Promise<
    readonly {
      name: string;
      inputSchema: Readonly<Record<string, unknown>>;
    }[]
  >;
  execute(request: {
    admission: ProcessAdmission;
    callId: string;
    name: string;
    args: Readonly<Record<string, unknown>>;
    signal: AbortSignal;
  }): Promise<{ text: string; isError?: boolean }>;
}

export interface RuntimeEventEnvelope {
  schema: number;
  sessionId: string;
  runId: string;
  eventId: string;
  sequence: number;
  timestamp: string;
  /** Canonical projection; primary provider history belongs to the BA-2 journal. */
  event: TimelineEvent;
}

export interface RuntimeEventPort {
  /** Ordered, acknowledged delivery; repeated eventId must not duplicate effects. */
  publish(admission: ProcessAdmission, event: RuntimeEventEnvelope): Promise<void>;
}

export interface RuntimeEnvironment {
  revision: string;
  cwd: string;
  readDirs: readonly string[];
  permissionMode: PermissionMode;
  readOnly: boolean;
  sandbox: { verified: boolean; backend: string | null; detail: string };
  /** References to managed services, not model API credentials or a second environment manager. */
  services: readonly { name: string; url: string }[];
}

export interface RuntimeEnvironmentPort {
  current(admission: ProcessAdmission, signal: AbortSignal): Promise<RuntimeEnvironment>;
}

/** Read-only projection of the existing completion service, never a second task state store. */
export interface RuntimeAcceptanceState {
  revision: string;
  /** Older projections without this binding cannot support evidence preflight. */
  binding?: {
    scope: Readonly<SkaroScope>;
    checkout: string;
    /** Checking may run before C4 review; submission still uses all acceptance gates. */
    execution: 'allowed' | 'blocked';
  };
  criteriaRevision: string;
  criteria: readonly { id: string; text?: string; met: boolean; evidenceIds: readonly string[] }[];
  openDecisions: readonly string[];
  c4: 'not-required' | 'current' | 'missing' | 'stale';
  result: 'not-submitted' | 'accepted' | 'stale';
  continuation: 'allowed' | 'stopped' | 'waiting-decision' | 'blocked' | 'budget-exhausted';
  reasons: readonly string[];
}

export interface RuntimeAcceptancePort {
  inspect(admission: ProcessAdmission, signal: AbortSignal): Promise<RuntimeAcceptanceState>;
}

/** Constructed by the adapter, bound by Skaro; no Electron/UI imports or global service access. */
export interface BuiltinAgentHost {
  versions: BuiltinContractVersions;
  sessionId: string;
  scope: Readonly<SkaroScope>;
  credentials: CredentialPort;
  operations: ScopedOperationPort;
  events: RuntimeEventPort;
  processes: ProcessAdmissionPort;
  environment: RuntimeEnvironmentPort;
  acceptance: RuntimeAcceptancePort;
}
