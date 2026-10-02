import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENT_PINS, agentPackage, type AgentId } from '@skaro/core';
import type { ReleaseAgent, ReleaseManifest } from './update-release';
import { STABLE_VERSION } from './update-release';

export interface BundleVersions {
  bundleVersion: string;
  skaroVersion: string;
  claudeSdk: string;
  adapters: Record<AgentId, string>;
  agents: Record<AgentId, ReleaseAgent>;
}

/** The release build embeds this file; dev uses only its real compiled pins. */
export async function currentBundle(
  version: string,
  resources: string,
  packaged: boolean,
): Promise<BundleVersions> {
  const agents = Object.fromEntries(
    ['codex', 'claude-code'].map((id) => {
      const pkg = agentPackage(id as AgentId);
      return [id, { version: pkg.version, shownVersion: pkg.shownVersion }];
    }),
  ) as Record<AgentId, ReleaseAgent>;
  if (!packaged)
    return {
      bundleVersion: version,
      skaroVersion: version,
      claudeSdk: AGENT_PINS['claude-code'],
      adapters: { codex: '0.0.0', 'claude-code': '0.0.0' },
      agents,
    };
  const bundled = JSON.parse(
    await readFile(join(resources, 'skaro-bundle.json'), 'utf8'),
  ) as BundleVersions;
  if (
    bundled.bundleVersion !== version ||
    !STABLE_VERSION.test(bundled.skaroVersion) ||
    bundled.claudeSdk !== AGENT_PINS['claude-code']
  )
    throw new Error('Installed Skaro bundle does not match its compiled pins');
  for (const id of ['codex', 'claude-code'] as const) {
    if (
      bundled.agents?.[id]?.version !== agents[id].version ||
      bundled.agents[id].shownVersion !== agents[id].shownVersion ||
      !STABLE_VERSION.test(bundled.adapters?.[id] ?? '')
    )
      throw new Error('Installed agent pins do not match the bundle');
  }
  return bundled;
}

export function sameBundle(expected: ReleaseManifest, actual: BundleVersions): boolean {
  return (
    expected.bundleVersion === actual.bundleVersion &&
    expected.skaroVersion === actual.skaroVersion &&
    expected.claudeSdk === actual.claudeSdk &&
    ['codex', 'claude-code'].every((id) => {
      const agent = id as AgentId;
      return (
        expected.adapters[agent] === actual.adapters[agent] &&
        expected.agents[agent].version === actual.agents[agent].version &&
        expected.agents[agent].shownVersion === actual.agents[agent].shownVersion
      );
    })
  );
}
