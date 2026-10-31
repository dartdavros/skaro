import type { AgentAdapter } from './agent.ts';
import type { Emit, ProjectionContext } from './projection.ts';
import type { Projector } from './replay.ts';

/** Serializable presentation only: no SDKs, Node modules or executable markup in renderer. */
export interface AgentPresentation {
  id: string;
  name: string;
  logo: {
    viewBox: string;
    fill?: string;
    color?: string;
    paths: { d: string; fill?: string; fillRule?: 'evenodd'; clipRule?: 'evenodd' }[];
  };
  boardLogoSize: number;
}

export interface AgentPlatform {
  os: string;
  arch: string;
  musl?: boolean;
}

export interface AgentPin {
  version: string;
  shownVersion: string;
}

export interface AgentDistribution extends AgentPin {
  agent: string;
  name: string;
  npmVersion: string;
  binary: string;
  pathDirs: string[];
}

/** Dependencies supplied by the host; native protocol and auth state stay in the adapter. */
export interface AgentHost {
  installed: () => Promise<{ binary: string; pathDirs: string[] } | undefined>;
  openUrl: (url: string) => void;
  authRevision: SharedArrayBuffer;
}

export interface AgentRuntime {
  createAdapter(
    host: AgentHost,
    options?: { configDir?: string; nativeConfig?: string[] },
  ): AgentAdapter;
  configDir(): string;
  probeBinary(resolvePackage: (name: string) => string): { binary: string; pathDirs: string[] };
}

export interface AgentDefinition {
  presentation: AgentPresentation;
  adapterVersion: string;
  package: { name: string; version: string; dependencies: Record<string, string> };
  pin: AgentPin;
  downloadSize: number;
  /** Required Skaro operations must be implemented, never silently emulated by no-ops. */
  capabilities: {
    resume: boolean;
    images: boolean;
    compact: boolean;
    rewind: 'conversation' | 'conversation-and-files';
    backgroundStop: boolean;
  };
  chatSandboxCheck: boolean;
  instructionFiles: readonly string[];
  questionTool: string;
  questionAgentName: string;
  releaseOrder: number;
  probeAlias: string;
  diagnosticVersionKey: string;
  /** Preserves public manifest v1 aliases without special cases in the updater. */
  legacyBundlePin?: string;
  sdkDependency?: string;
  distribution(platform: AgentPlatform, pin: AgentPin): AgentDistribution;
  loadProjector(): Promise<
    (context: ProjectionContext, emit: Emit, adapterVersion?: string) => Projector
  >;
  loadRuntime(): Promise<AgentRuntime>;
}
