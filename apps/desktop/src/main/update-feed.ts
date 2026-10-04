import { parse } from 'yaml';
import {
  RELEASE_API,
  RELEASE_ROOT,
  parseRelease,
  releasePlatform,
  SHA512,
  type ReleaseManifest,
} from './update-release';
import type { Platform } from '@skaro/core';

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string }[];
}

async function request(url: string, fetcher: typeof fetch): Promise<Response> {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`Update feed: HTTP ${response.status}`);
  return response;
}

/** Uses only assets attached to the stable Skaro release; empty old releases are not updates. */
export async function fetchRelease(
  platform: Platform,
  fetcher: typeof fetch,
): Promise<ReleaseManifest | undefined> {
  const response = await fetcher(RELEASE_API, {
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`GitHub: HTTP ${response.status}`);
  const release = (await response.json()) as GitHubRelease;
  if (release.draft || release.prerelease) return undefined;
  const base = `${RELEASE_ROOT}/download/${release.tag_name}/`;
  const asset = (name: string) => {
    const found = release.assets?.find((a) => a.name === name);
    if (!found || found.browser_download_url !== base + encodeURIComponent(name))
      throw new Error(`Release asset missing: ${name}`);
    return found.browser_download_url;
  };
  if (!release.assets?.some((a) => a.name === 'skaro-release.json')) return undefined;
  const manifest = parseRelease(await (await request(asset('skaro-release.json'), fetcher)).json());
  if (release.tag_name !== `v${manifest.bundleVersion}`)
    throw new Error('Release tag does not match the bundle');
  const selected = releasePlatform(manifest, platform);
  asset(selected.payload.name);
  const feed = parse(await (await request(asset(selected.feed), fetcher)).text()) as {
    version?: string;
    files?: { url: string; sha512: string; size: number }[];
  };
  if (feed?.version !== manifest.bundleVersion || !feed.files?.length)
    throw new Error('Update feed does not match the bundle');
  for (const file of feed.files) {
    if (!file || !SHA512.test(file.sha512) || !Number.isSafeInteger(file.size) || file.size <= 0)
      throw new Error('Invalid update payload integrity');
    asset(file.url);
  }
  const payload = feed.files.find((f) => f.url === selected.payload.name);
  if (
    !payload ||
    payload.sha512 !== selected.payload.sha512 ||
    payload.size !== selected.payload.size
  )
    throw new Error('Update payload does not match the manifest');
  return manifest;
}
