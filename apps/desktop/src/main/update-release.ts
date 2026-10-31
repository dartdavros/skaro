import { RELEASE_AGENT_IDS, matchesLegacyBundlePins, type LegacyBundlePins } from '@skaro/agents';
import { isDeepStrictEqual } from 'node:util';
import {
  agentPackage,
  type AgentId,
  type AgentPackage,
  type AgentArtifact,
  type Platform,
} from '@skaro/core';
import type { UpdateComponent } from '../shared/updates';

export const RELEASE_ROOT = 'https://github.com/dartdavros/skaro/releases';
export const RELEASE_API = 'https://api.github.com/repos/dartdavros/skaro/releases/latest';
export const AGENT_IDS = RELEASE_AGENT_IDS;
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

/** AppImage uses x86_64 in filenames while Electron calls that architecture x64. */
export function releasePayloadSuffix(os: string, arch: string): string {
  const artifactArch = os === 'linux' && arch === 'x64' ? 'x86_64' : arch;
  const extension = os === 'darwin' ? '.dmg' : os === 'linux' ? '.AppImage' : '.exe';
  return `-${artifactArch}${extension}`;
}

export interface ReleaseAgent {
  version: string;
  shownVersion: string;
}
export interface ReleasePlatform {
  /** Channel metadata published separately from the public installers. */
  feed: string;
  payload: { name: string; sha512: string; size: number };
  agents: Record<AgentId, AgentPackage & AgentArtifact>;
}
export interface ReleaseManifest extends LegacyBundlePins {
  schema: 1;
  bundleVersion: string;
  skaroVersion: string;
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
  if (!matchesLegacyBundlePins(m, m.agents) || !m.platforms || !Object.keys(m.platforms).length)
    fail();
  for (const [key, platform] of Object.entries(m.platforms)) {
    const base = key.replace(/-musl$/, '');
    if (!PLATFORM_KEYS.includes(key)) fail();
    const [os, arch] = base.split('-');
    const expectedFeed = updateFeedName(os!, arch!);
    if (platform.feed !== expectedFeed) fail();
    const payload = platform.payload;
    const extension = os === 'darwin' ? '.dmg' : os === 'linux' ? '.AppImage' : '.exe';
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

/** Assemble only a complete, consistent set of independently built platforms. */
export function mergeReleaseParts(
  bundle: Omit<ReleaseManifest, 'schema' | 'platforms'>,
  parts: ReleaseManifest[],
): ReleaseManifest {
  const expected = { schema: 1 as const, ...bundle };
  const manifest: ReleaseManifest = { ...expected, platforms: {} };
  for (const value of parts) {
    const { platforms, ...metadata } = parseRelease(value);
    if (!isDeepStrictEqual(metadata, expected))
      throw new Error('Release parts have different pinned bundles');
    const keys = Object.keys(platforms);
    if (keys.length !== 1 || manifest.platforms[keys[0]!])
      throw new Error('Expected one unique platform per release part');
    Object.assign(manifest.platforms, platforms);
  }
  if (PLATFORM_KEYS.some((key) => !manifest.platforms[key]))
    throw new Error('All six supported release platforms must pass before publication');
  return parseRelease(manifest);
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
