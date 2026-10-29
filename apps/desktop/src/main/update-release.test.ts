import { describe, expect, it } from 'vitest';
import { agentPackage } from '@skaro/core';
import { sameBundle } from './update-current';
import { recoveryDecision } from './update-recovery';
import {
  changedComponents,
  newer,
  mergeReleaseParts,
  PLATFORM_KEYS,
  parseRelease,
  releasePlatform,
  updateFeedName,
  releasePayloadSuffix,
  type ReleaseManifest,
} from './update-release';
import { installerUrl, updateFeedBase } from './update-locations';

/** In-memory contract inputs only: no update server, app payload or installed binary. */
function manifest(): ReleaseManifest {
  const agents = {
    codex: { version: '0.159.2', shownVersion: '0.159.2' },
    'claude-code': { version: '0.3.285', shownVersion: '2.1.285' },
  };
  const integrity = 'sha512-' + Buffer.alloc(64).toString('base64');
  const platform = { os: 'win32' as const, arch: 'x64' };
  return {
    schema: 1,
    bundleVersion: '2.0.4',
    skaroVersion: '2.0.3',
    claudeSdk: '0.3.285',
    adapters: { codex: '0.0.0', 'claude-code': '0.0.0' },
    agents,
    platforms: {
      'win32-x64': {
        feed: updateFeedName(platform.os, platform.arch),
        payload: { name: 'Skaro-2.0.4-win-x64.exe', sha512: integrity.slice(7), size: 100 },
        agents: {
          codex: {
            ...agentPackage('codex', platform, agents.codex),
            integrity,
            tarball: 'https://registry.npmjs.org/@openai/codex/-/codex-0.159.2-win32-x64.tgz',
          },
          'claude-code': {
            ...agentPackage('claude-code', platform, agents['claude-code']),
            integrity,
            tarball:
              'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-win32-x64/-/claude-agent-sdk-win32-x64-0.3.285.tgz',
          },
        },
      },
    },
  };
}

describe('release compatibility', () => {
  it('confirms only the exact installed bundle, including adapters, SDK and displayed pins', () => {
    const next = manifest();
    const actual = {
      bundleVersion: next.bundleVersion,
      skaroVersion: next.skaroVersion,
      claudeSdk: next.claudeSdk,
      adapters: { ...next.adapters },
      agents: structuredClone(next.agents),
    };
    const pending = { manifest: next, agents: [], files: [], applying: true };
    expect(recoveryDecision(pending, actual)).toBe('confirm');
    expect(recoveryDecision({ ...pending, applying: false }, actual)).toBe('confirm');
    expect(recoveryDecision(pending, { ...actual, bundleVersion: '2.0.3' })).toBe('resume');
    // A newer installation overtook the downloaded bundle: it must not be offered again.
    expect(
      recoveryDecision({ ...pending, applying: false }, { ...actual, bundleVersion: '2.0.5' }),
    ).toBe('superseded');
    for (const changed of [
      { ...actual, skaroVersion: '2.1.0' },
      { ...actual, claudeSdk: '0.3.281' },
      { ...actual, adapters: { ...actual.adapters, codex: '0.0.1' } },
      {
        ...actual,
        agents: { ...actual.agents, codex: { version: '0.156.1', shownVersion: '0.156.1' } },
      },
    ]) {
      expect(sameBundle(next, changed)).toBe(false);
      expect(recoveryDecision(pending, changed)).toBe('unverified');
    }
  });
  it('compares only stable complete versions, without treating prereleases as latest', () => {
    expect(newer('2.0.4', '2.0.3')).toBe(true);
    expect(newer('2.0.3', '2.0.3')).toBe(false);
    expect(newer('2.0.4-beta.1', '2.0.3')).toBe(false);
    expect(newer('v2.0.4', '2.0.3')).toBe(false);
    expect(newer('2.0.2', '2.0.3')).toBe(false);
  });
  it('shows only the installed changed agent in an agent-only bundle', () => {
    const next = manifest();
    const current = {
      skaroVersion: '2.0.3',
      agents: {
        codex: { version: '0.156.1', shownVersion: '0.156.1' },
        'claude-code': { version: '0.3.281', shownVersion: '2.1.281' },
      },
    };
    expect(changedComponents(next, current, ['codex']).map((c) => c.id)).toEqual(['codex']);
    expect(changedComponents(next, current, [])).toEqual([]);
    next.skaroVersion = '2.1.0';
    expect(changedComponents(next, current, ['codex', 'claude-code']).map((c) => c.id)).toEqual([
      'skaro',
      'codex',
      'claude-code',
    ]);
  });
  it('rejects an SDK, platform package or integrity that differs from the approved pin', () => {
    expect(parseRelease(manifest()).bundleVersion).toBe('2.0.4');
    const sdk = manifest();
    sdk.claudeSdk = '0.3.281';
    expect(() => parseRelease(sdk)).toThrow();
    const pkg = manifest();
    pkg.platforms['win32-x64']!.agents.codex.npmVersion = 'latest';
    expect(() => parseRelease(pkg)).toThrow();
    const hash = manifest();
    hash.platforms['win32-x64']!.agents.codex.integrity = 'sha1-short';
    expect(() => parseRelease(hash)).toThrow();
    const origin = manifest();
    origin.platforms['win32-x64']!.agents.codex.tarball = 'https://example.org/codex.tgz';
    expect(() => parseRelease(origin)).toThrow();
    const traversal = manifest();
    traversal.platforms['win32-x64']!.agents.codex.binary = '../codex.exe';
    expect(() => parseRelease(traversal)).toThrow();
  });
  it('does not offer a payload for an unsupported host', () => {
    expect(() => releasePlatform(manifest(), { os: 'linux', arch: 'x64', musl: true })).toThrow();
    expect(() => releasePlatform(manifest(), { os: 'win32', arch: 'ia32' })).toThrow();
  });
  it('uses the actual electron-updater platform/architecture channel naming', () => {
    expect(updateFeedName('linux', 'arm64')).toBe('latest-linux-arm64.yml');
    expect(updateFeedName('linux', 'x64')).toBe('latest-linux.yml');
    expect(updateFeedName('darwin', 'arm64')).toBe('latest-arm64-mac.yml');
    expect(updateFeedName('win32', 'arm64')).toBe('latest-arm64.yml');
  });
  it('matches native installer filenames including the AppImage x86_64 architecture', () => {
    expect(releasePayloadSuffix('linux', 'x64')).toBe('-x86_64.AppImage');
    expect(releasePayloadSuffix('linux', 'arm64')).toBe('-arm64.AppImage');
    expect(releasePayloadSuffix('darwin', 'x64')).toBe('-x64.dmg');
    expect(releasePayloadSuffix('darwin', 'arm64')).toBe('-arm64.dmg');
    expect(releasePayloadSuffix('win32', 'x64')).toBe('-x64.exe');
    expect(releasePayloadSuffix('win32', 'arm64')).toBe('-arm64.exe');
  });
  it('separates service metadata from exact installer assets and rejects unsafe locations', () => {
    expect(updateFeedBase('2.0.3')).toBe(
      'https://raw.githubusercontent.com/dartdavros/skaro/updates/v2.0.3/',
    );
    expect(installerUrl('2.0.3', 'Skaro-2.0.3-win-x64.exe')).toBe(
      'https://github.com/dartdavros/skaro/releases/download/v2.0.3/Skaro-2.0.3-win-x64.exe',
    );
    for (const name of ['../evil.exe', 'https://example.org/evil.exe', 'unused.zip'])
      expect(() => installerUrl('2.0.3', name)).toThrow();
    expect(() => updateFeedBase('../main')).toThrow();
  });
  it('merges all six platforms without comparing the already accumulated platforms', () => {
    const { platforms: _platforms, schema: _schema, ...bundle } = manifest();
    const parts = releaseParts();
    const merged = mergeReleaseParts(bundle, parts);
    expect(Object.keys(merged.platforms)).toEqual(PLATFORM_KEYS);
    expect(parts.every((part) => Object.keys(part.platforms).length === 1)).toBe(true);
    expect(mergeReleaseParts(bundle, parts.toReversed())).toEqual(merged);
  });
  it('rejects incomplete, duplicate and mismatched platform bundles before publication', () => {
    const { platforms: _platforms, schema: _schema, ...bundle } = manifest();
    const parts = releaseParts();
    expect(() => mergeReleaseParts(bundle, parts.slice(1))).toThrow('All six');
    expect(() => mergeReleaseParts(bundle, [...parts, parts[0]!])).toThrow('unique platform');
    for (const change of [
      { bundleVersion: '2.0.5' },
      { skaroVersion: '2.0.5' },
      { adapters: { ...bundle.adapters, codex: '0.0.1' } },
    ]) {
      expect(() =>
        mergeReleaseParts(bundle, [{ ...parts[0]!, ...change }, ...parts.slice(1)]),
      ).toThrow('different pinned bundles');
    }
  });
});

/** Pure manifest inputs: no files, binaries, HTTP servers or substituted fetch. */
function releaseParts(): ReleaseManifest[] {
  return PLATFORM_KEYS.map((key) => {
    const part = manifest();
    const [os, arch] = key.split('-') as [NodeJS.Platform, string];
    const selected = part.platforms['win32-x64']!;
    selected.feed = updateFeedName(os, arch);
    selected.payload.name = `Skaro-2.0.4-${key}${os === 'win32' ? '.exe' : os === 'darwin' ? '.dmg' : '.AppImage'}`;
    for (const id of ['codex', 'claude-code'] as const)
      selected.agents[id] = {
        ...selected.agents[id],
        ...agentPackage(id, { os, arch }, part.agents[id]),
      };
    part.platforms = { [key]: selected };
    return part;
  });
}
