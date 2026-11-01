import type { AgentSession, PermissionMode, SessionOptions } from './agent.ts';
import type { BuiltinContractVersions } from './builtin-version.ts';
import type { RouteSnapshot } from './builtin-model.ts';
import type { BuiltinToolScope } from './builtin-tools.ts';
import type { BuiltinContextConfig } from './builtin-context.ts';
import type { BuiltinExtensionPolicy } from './builtin-extensions.ts';
import type { RuntimeVerificationHost } from './builtin-host.ts';
import type { RuntimeScopedExtensionHost } from './builtin-extensions.ts';
import type { SkaroScope } from './skaro-scope.ts';

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
}

export interface BuiltinSessionOptions extends Pick<
  SessionOptions,
  'signal' | 'processStarted' | 'raw'
> {
  config: BuiltinSessionStart;
  entry?: string;
  /** In-process host port. Transports serialize only its scope/admission binding. */
  verification?: RuntimeVerificationHost;
  extensions?: RuntimeScopedExtensionHost;
}

export interface BundledSessionRuntime {
  start(options: BuiltinSessionOptions): Promise<AgentSession>;
}
