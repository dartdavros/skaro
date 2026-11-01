import type { RuntimeVerificationBinding } from './builtin-host.ts';

/** Nonsecret persisted host policy, never inferred from remote MCP annotations. */
export interface BuiltinExtensionPolicy {
  name: string;
  revision: string;
  readOnly: boolean;
}

export interface RuntimeExtensionDescriptor extends BuiltinExtensionPolicy {
  observation?: { kind: 'browser'; criteria: readonly string[] };
  description: string;
  inputSchema: Record<string, unknown>;
}
export interface RuntimeExtension extends RuntimeExtensionDescriptor {
  invoke(id: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
}
export interface RuntimeExtensionHost {
  tools: readonly RuntimeExtension[];
  /** Only ports that can preserve admission without owned services implement this. */
  interrupt?(): Promise<void>;
  close(): Promise<void>;
}
export interface RuntimeExtensionBinding extends RuntimeVerificationBinding {
  tools: readonly RuntimeExtensionDescriptor[];
}
export interface RuntimeScopedExtensionHost extends RuntimeVerificationBinding {
  extensions: RuntimeExtensionHost;
  signal?: AbortSignal;
}
