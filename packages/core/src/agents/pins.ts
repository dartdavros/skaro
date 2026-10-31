// Platform detection stays in core; distribution details belong to registered adapters.
import { agentDefinition, requireAgentId } from '@skaro/agents';
import type { AgentId } from '@skaro/agents';
import type { AgentDistribution, AgentPin } from '@skaro/timeline';
export { AGENT_PINS } from '@skaro/agents';
export type { AgentId } from '@skaro/agents';
export interface Platform {
  os: NodeJS.Platform;
  arch: string;
  musl?: boolean;
}
export interface AgentPackage extends AgentDistribution {
  agent: AgentId;
}

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

export function agentPackage(
  agent: AgentId,
  platform: Platform = currentPlatform(),
  pin?: AgentPin,
): AgentPackage {
  const definition = agentDefinition(agent);
  const pkg = definition.distribution(platform, pin ?? definition.pin);
  return { ...pkg, agent: requireAgentId(pkg.agent) };
}
