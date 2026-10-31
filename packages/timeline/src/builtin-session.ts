import type { AgentSession, PermissionMode, SessionOptions } from './agent.ts';
import type { BuiltinContractVersions } from './builtin-version.ts';
import type { RouteSnapshot } from './builtin-model.ts';
import type { BuiltinToolScope } from './builtin-tools.ts';

export interface BuiltinSessionStart {
  sessionId: string;
  journalPath: string;
  route: RouteSnapshot;
  permissionMode: PermissionMode;
  versions: BuiltinContractVersions;
  /** Exact configured selections from the host. setModel receives one of these route IDs. */
  availableRoutes?: readonly RouteSnapshot[];
  tools?: BuiltinToolScope;
}

export interface BuiltinSessionOptions extends Pick<
  SessionOptions,
  'signal' | 'processStarted' | 'raw'
> {
  config: BuiltinSessionStart;
  entry?: string;
}

export interface BundledSessionRuntime {
  start(options: BuiltinSessionOptions): Promise<AgentSession>;
}
