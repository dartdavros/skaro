import type { AgentSession, PermissionMode, SessionOptions } from './agent.ts';
import type { BuiltinContractVersions } from './builtin-version.ts';
import type { RouteSnapshot } from './builtin-model.ts';
import type { BuiltinToolScope } from './builtin-tools.ts';
import type { BuiltinContextConfig } from './builtin-context.ts';
import type { BuiltinExtensionPolicy } from './builtin-extensions.ts';
import type { RuntimeVerificationHost } from './builtin-host.ts';
import type { RuntimeScopedExtensionHost } from './builtin-extensions.ts';
import type { SkaroScope } from './skaro-scope.ts';
import type { RuntimeModelHost, RuntimeModelPolicy } from './builtin-model-host.ts';

export interface BuiltinSessionStart {
  sessionId: string;
  journalPath: string;
  route: RouteSnapshot;
  permissionMode: PermissionMode;
  versions: BuiltinContractVersions;
  /** Exact configured selections from the host. setModel receives one of these route IDs. */
  availableRoutes?: readonly RouteSnapshot[];
  tools?: BuiltinToolScope;
  context?: BuiltinContextConfig;
  extensions?: readonly BuiltinExtensionPolicy[];
  /** Persisted authority for native host operations; cannot change on resume. */
  extensionsScope?: Readonly<SkaroScope>;
  model?: RuntimeModelPolicy;
}

/** A host log's last copied primary record. Ephemeral delivery state, never runtime config. */
export interface BuiltinJournalReplayBoundary {
  sessionId: string;
  sequence: number;
  hash: string;
}

export interface RuntimeSessionHost {
  verification?: RuntimeVerificationHost;
  extensions?: RuntimeScopedExtensionHost;
  model?: RuntimeModelHost;
}

export interface BuiltinSessionOptions
  extends
    Pick<SessionOptions, 'signal' | 'processStarted' | 'raw' | 'journalReplay'>,
    RuntimeSessionHost {
  config: BuiltinSessionStart;
  entry?: string;
  commandEnvironment?: Readonly<Record<string, string>>;
  /** In-process host port. Transports serialize only its scope/admission binding. */
}

export interface BundledSessionRuntime {
  start(options: BuiltinSessionOptions): Promise<AgentSession>;
}
