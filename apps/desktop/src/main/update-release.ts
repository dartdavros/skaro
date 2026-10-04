import {
  agentPackage,
  type AgentId,
  type AgentPackage,
  type AgentArtifact,
  type Platform,
} from '@skaro/core';
import type { UpdateComponent } from '../shared/updates';

export const RELEASE_ROOT = 'https://github.com/skarodev/skaro/releases';
export const RELEASE_API = 'https://api.github.com/repos/skarodev/skaro/releases/latest';
export const AGENT_IDS: AgentId[] = ['codex', 'claude-code'];
export const PLATFORM_KEYS = [
  'win32-x64',
  'win32-arm64',
  'darwin-x64',
  'darwin-arm64',
  'linux-x64',
  'linux-arm64',
];
export const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const SHA512 = /^[A-Za-z0-9+/]{86}==$/;

export function updateFeedName(os: string, arch: string): string {
  return os === 'linux'
    ? `latest-linux${arch === 'x64' ? '' : `-${arch}`}.yml`
    : `latest-${arch}${os === 'darwin' ? '-mac' : ''}.yml`;
}

export interface ReleaseAgent {
  version: string;
  shownVersion: string;
}
export interface ReleasePlatform {
  /** electron-builder channel feed in the same immutable GitHub release. */
  feed: string;
  payload: { name: string; sha512: string; size: number };
  agents: Record<AgentId, AgentPackage & AgentArtifact>;
}
export interface ReleaseManifest {
  schema: 1;
  bundleVersion: string;
  skaroVersion: string;
  claudeSdk: string;
  adapters: Record<AgentId, string>;
  agents: Record<AgentId, ReleaseAgent>;
  platforms: Record<string, ReleasePlatform>;
}

export function newer(latest: string, current: string): boolean {
  if (!STABLE_VERSION.test(latest) || !STABLE_VERSION.test(current)) return false;
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

/** Reject malformed or unsupported bundles before exposing any update action. */
export function parseRelease(value: unknown): ReleaseManifest {
  const m = value as ReleaseManifest;
  const fail = () => {
    throw new Error('Invalid Skaro release manifest');
  };
  if (
    !m ||
    m.schema !== 1 ||
    !STABLE_VERSION.test(m.bundleVersion) ||
    !STABLE_VERSION.test(m.skaroVersion)
  )
    fail();
  for (const id of AGENT_IDS) {
    const pin = m.agents?.[id];
    if (
      !pin ||
      !STABLE_VERSION.test(pin.version) ||
      !STABLE_VERSION.test(pin.shownVersion) ||
      !STABLE_VERSION.test(m.adapters?.[id] ?? '')
    )
      fail();
  }
  if (
    m.claudeSdk !== m.agents['claude-code'].version ||
    !m.platforms ||
    !Object.keys(m.platforms).length
  )
    fail();
  for (const [key, platform] of Object.entries(m.platforms)) {
    const base = key.replace(/-musl$/, '');
    if (!PLATFORM_KEYS.includes(key)) fail();
    const [os, arch] = base.split('-');
    const expectedFeed = updateFeedName(os!, arch!);
    if (platform.feed !== expectedFeed) fail();
    const payload = platform.payload;
    const extension = os === 'darwin' ? '.zip' : os === 'linux' ? '.AppImage' : '.exe';
    if (
      !payload ||
      !/^[\w .-]+$/.test(payload.name) ||
      !payload.name.endsWith(extension) ||
      !SHA512.test(payload.sha512) ||
      !Number.isSafeInteger(payload.size) ||
      payload.size <= 0
    )
      fail();
    for (const id of AGENT_IDS) {
      const pkg = platform.agents?.[id];
      const expected = agentPackage(
        id,
        { os: os as NodeJS.Platform, arch: arch!, musl: key.endsWith('-musl') },
        m.agents[id],
      );
      for (const field of [
        'agent',
        'version',
        'shownVersion',
        'name',
        'npmVersion',
        'binary',
      ] as const)
        if (pkg?.[field] !== expected[field]) fail();
      if (
        JSON.stringify(pkg?.pathDirs) !== JSON.stringify(expected.pathDirs) ||
        !pkg ||
        !pkg.integrity?.startsWith('sha512-') ||
        !SHA512.test(pkg.integrity.slice(7))
      )
        fail();
      const url = new URL(pkg.tarball);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'registry.npmjs.org' ||
        url.username ||
        url.password
      )
        fail();
    }
  }
  return m;
}

export function releasePlatform(m: ReleaseManifest, p: Platform): ReleasePlatform {
  const key = `${p.os}-${p.arch}${p.musl ? '-musl' : ''}`;
  const platform = m.platforms[key];
  if (!platform) throw new Error(`Skaro update is not available for ${key}`);
  return platform;
}

export function changedComponents(
  next: ReleaseManifest,
  current: { skaroVersion: string; agents: Record<AgentId, ReleaseAgent> },
  installed: readonly AgentId[],
): UpdateComponent[] {
  const url = `${RELEASE_ROOT}/tag/v${next.bundleVersion}`;
  const result: UpdateComponent[] = [];
  if (newer(next.skaroVersion, current.skaroVersion))
    result.push({ id: 'skaro', current: current.skaroVersion, latest: next.skaroVersion, url });
  for (const id of AGENT_IDS) {
    if (installed.includes(id) && next.agents[id].version !== current.agents[id].version)
      result.push({
        id,
        current: current.agents[id].shownVersion,
        latest: next.agents[id].shownVersion,
        url,
      });
  }
  return result;
}
