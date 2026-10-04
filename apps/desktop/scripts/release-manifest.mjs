// Produces immutable release metadata alongside real electron-builder artifacts.
import { readFile, readdir, writeFile, copyFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { desktop, bundleMetadata } from './bundle-metadata.mjs';
import { agentPackage } from '../../../packages/core/src/agents/pins.ts';
import { parseRelease, updateFeedName } from '../src/main/update-release.ts';

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
  const feed = parse(await readFile(join(dir, standard), 'utf8'));
  if (feed.version !== bundle.bundleVersion)
    throw new Error('electron-builder version does not match the bundle');
  const extension = os === 'darwin' ? '.zip' : os === 'linux' ? '.AppImage' : '.exe';
  const payload = feed.files.find(
    (file) => file.url.endsWith(extension) && file.url.includes(arch),
  );
  if (!payload) throw new Error(`Missing ${os}-${arch} payload in electron-builder feed`);
  if ((await stat(join(dir, payload.url))).size !== payload.size)
    throw new Error('Built payload size mismatch');
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(join(dir, payload.url))) hash.update(chunk);
  if (hash.digest('base64') !== payload.sha512) throw new Error('Built payload SHA512 mismatch');
  if (standard !== destination) await copyFile(join(dir, standard), join(dir, destination));
  const agents = {};
  for (const id of ['codex', 'claude-code']) {
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
        payload: { name: payload.url, sha512: payload.sha512, size: payload.size },
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
  const manifest = { schema: 1, ...bundle, platforms: {} };
  for (const name of parts) {
    const part = parseRelease(JSON.parse(await readFile(join(dir, name), 'utf8')));
    if (JSON.stringify({ ...part, platforms: {} }) !== JSON.stringify(manifest))
      throw new Error('Release parts have different pinned bundles');
    Object.assign(manifest.platforms, part.platforms);
  }
  if (Object.keys(manifest.platforms).length !== 6)
    throw new Error('All six supported release platforms must pass before publication');
  parseRelease(manifest);
  await writeFile(join(dir, 'skaro-release.json'), JSON.stringify(manifest, null, 2) + '\n');
} else throw new Error('Usage: node scripts/release-manifest.mjs platform|merge');
