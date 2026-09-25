// Agent versions pinned by this Skaro release (D-23, D-26) and where their binaries live.

export type AgentId = 'claude-code' | 'codex';

/** Pinned versions. Bump together with adapter golden tests (agent-output.md, section 8). */
export const AGENT_PINS: Record<AgentId, string> = {
  'claude-code': '0.3.281', // @anthropic-ai/claude-agent-sdk (Claude Code 2.1.281)
  codex: '0.156.1', // @openai/codex
};

export interface Platform {
  os: NodeJS.Platform;
  arch: string;
  /** Linux only: musl-based distributions need musl builds. */
  musl?: boolean;
}

export interface AgentPackage {
  agent: AgentId;
  /** Version shown to the user. */
  version: string;
  /** npm package and version that carry the binary for this platform. */
  name: string;
  npmVersion: string;
  /** Executable, relative to the unpacked package. */
  binary: string;
  /** Directories (relative) to prepend to PATH when running the agent. */
  pathDirs: string[];
}

const CODEX_TRIPLES: Record<string, string> = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
};

let musl: boolean | undefined;

/** Linux without glibc: the process report names the glibc version only where it runs. */
function isMusl(): boolean {
  if (process.platform !== 'linux') return false;
  if (musl === undefined) {
    // A full report resolves the peer of every open socket, which blocks the main thread
    // for tens of seconds where reverse DNS hangs (macOS CI runners); sockets are not needed.
    const report = process.report as NodeJS.ProcessReport & { excludeNetwork?: boolean };
    const excludeNetwork = report.excludeNetwork;
    report.excludeNetwork = true;
    try {
      const header = (report.getReport() as { header?: { glibcVersionRuntime?: string } }).header;
      musl = !header?.glibcVersionRuntime;
    } finally {
      report.excludeNetwork = excludeNetwork;
    }
  }
  return musl;
}

export function currentPlatform(): Platform {
  return { os: process.platform, arch: process.arch, musl: isMusl() };
}

export function agentPackage(agent: AgentId, platform: Platform = currentPlatform()): AgentPackage {
  const key = `${platform.os}-${platform.arch}`;
  const exe = platform.os === 'win32' ? '.exe' : '';
  const version = AGENT_PINS[agent];
  if (agent === 'claude-code') {
    if (
      !['win32', 'darwin', 'linux'].includes(platform.os) ||
      !['x64', 'arm64'].includes(platform.arch)
    ) {
      throw new Error(`Claude Code is not available for ${key}`);
    }
    return {
      agent,
      version,
      name: `@anthropic-ai/claude-agent-sdk-${key}${platform.musl ? '-musl' : ''}`,
      npmVersion: version,
      binary: `claude${exe}`,
      pathDirs: [],
    };
  }
  const triple = CODEX_TRIPLES[key];
  if (!triple) throw new Error(`Codex is not available for ${key}`);
  return {
    agent,
    version,
    name: '@openai/codex',
    npmVersion: `${version}-${key}`,
    binary: `vendor/${triple}/bin/codex${exe}`,
    pathDirs: [`vendor/${triple}/codex-path`],
  };
}
