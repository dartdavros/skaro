import type { AgentId, AgentInstaller, Platform } from '@skaro/core';
import { releasePlatform, type ReleaseManifest } from './update-release';
import type { PendingUpdate } from './update-journal';

export async function prepareAgents(
  installer: AgentInstaller,
  manifest: ReleaseManifest,
  host: Platform,
  installed: AgentId[],
  progress: (percent: number) => void,
): Promise<void> {
  const platform = releasePlatform(manifest, host);
  for (let i = 0; i < installed.length; i++) {
    const pkg = platform.agents[installed[i]!];
    await installer.installPackage(pkg, pkg, (received, total) =>
      progress(70 + (30 * (i + (total ? received / total : 0))) / installed.length),
    );
  }
}

export async function verifyAgents(
  installer: AgentInstaller,
  pending: PendingUpdate,
  host: Platform,
  installed: AgentId[],
): Promise<void> {
  const platform = releasePlatform(pending.manifest, host);
  for (const id of new Set([...pending.agents, ...installed])) {
    const pkg = platform.agents[id];
    if (!(await installer.installedPackage(pkg, pkg.integrity)))
      throw new Error(`${id}: the approved binary is not installed`);
  }
}
