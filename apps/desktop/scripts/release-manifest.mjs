import { RELEASE_AGENT_IDS } from '../../../packages/agents/src/index.ts';
// Produces immutable release metadata alongside real electron-builder artifacts.
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { desktop, bundleMetadata } from './bundle-metadata.mjs';
import { agentPackage } from '../../../packages/core/src/agents/pins.ts';
import {
  mergeReleaseParts,
  parseRelease,
  releasePayloadSuffix,
  updateFeedName,
} from '../src/main/update-release.ts';
import { releaseAssets } from './release-assets.mjs';
import { installerUrl } from '../src/main/update-locations.ts';

const dir = join(desktop, 'release');
const mode = process.argv[2];
const bundle = await bundleMetadata();
if (!process.env.SKARO_BUNDLE_VERSION || !process.env.SKARO_PRODUCT_VERSION)
  throw new Error('Release versions must be supplied explicitly');

if (mode === 'platform') {
  const os = process.platform;
  const arch = process.env.SKARO_RELEASE_ARCH ?? process.arch;
  const standard =
    os === 'darwin'
      ? 'latest-mac.yml'
      : os === 'linux'
        ? `latest-linux${arch === 'x64' ? '' : `-${arch}`}.yml`
        : 'latest.yml';
  const destination = updateFeedName(os, arch);
  // Unsigned macOS updates are manual: publish the DMG, without an unused ZIP.
  const dmg = (await readdir(dir)).find((name) =>
    name.endsWith(`-mac${releasePayloadSuffix(os, arch)}`),
  );
  const feed =
    os === 'darwin'
      ? { version: bundle.bundleVersion, files: [{ url: dmg }] }
      : parse(await readFile(join(dir, standard), 'utf8'));
  if (feed.version !== bundle.bundleVersion)
    throw new Error('electron-builder version does not match the bundle');
  const payload = feed.files.find((file) => file.url?.endsWith(releasePayloadSuffix(os, arch)));
  if (!payload) throw new Error(`Missing ${os}-${arch} payload in electron-builder feed`);
  const size = (await stat(join(dir, payload.url))).size;
  if (os !== 'darwin' && size !== payload.size) throw new Error('Built payload size mismatch');
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(join(dir, payload.url))) hash.update(chunk);
  const sha512 = hash.digest('base64');
  if (os !== 'darwin' && sha512 !== payload.sha512)
    throw new Error('Built payload SHA512 mismatch');
  const name = payload.url;
  await writeFile(
    join(dir, destination),
    stringify({
      version: bundle.bundleVersion,
      files: [{ url: installerUrl(bundle.bundleVersion, name), sha512, size }],
    }),
  );
  const agents = {};
  for (const id of RELEASE_AGENT_IDS) {
    const pkg = agentPackage(id, { os, arch, musl: false });
    const name = pkg.name.startsWith('@')
      ? '@' + encodeURIComponent(pkg.name.slice(1))
      : encodeURIComponent(pkg.name);
    const response = await fetch(
      `https://registry.npmjs.org/${name}/${encodeURIComponent(pkg.npmVersion)}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    if (!response.ok) throw new Error(`${pkg.name}@${pkg.npmVersion}: HTTP ${response.status}`);
    const metadata = await response.json();
    agents[id] = { ...pkg, tarball: metadata.dist.tarball, integrity: metadata.dist.integrity };
  }
  const manifest = {
    schema: 1,
    ...bundle,
    platforms: {
      [`${os}-${arch}`]: {
        feed: destination,
        payload: { name, sha512, size },
        agents,
      },
    },
  };
  parseRelease(manifest);
  await writeFile(
    join(dir, `skaro-release-${os}-${arch}.json`),
    JSON.stringify(manifest, null, 2) + '\n',
  );
} else if (mode === 'merge') {
  const parts = (await readdir(dir)).filter((name) =>
    /^skaro-release-(win32|darwin|linux)-(x64|arm64)\.json$/.test(name),
  );
  const manifests = [];
  for (const name of parts) {
    const part = parseRelease(JSON.parse(await readFile(join(dir, name), 'utf8')));
    if (Object.keys(part.platforms).join() !== name.slice(14, -5))
      throw new Error(`Release part platform does not match its filename: ${name}`);
    manifests.push(part);
  }
  const manifest = mergeReleaseParts(bundle, manifests);
  await releaseAssets(dir, manifest);
  await writeFile(join(dir, 'skaro-release.json'), JSON.stringify(manifest, null, 2) + '\n');
} else throw new Error('Usage: node scripts/release-manifest.mjs platform|merge');
