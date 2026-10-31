// Build metadata from the real source pins and dependency manifests, never npm latest.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { agentPackage } from '../../../packages/core/src/agents/pins.ts';

import { RELEASE_AGENT_IDS, legacyBundlePins } from '../../../packages/agents/src/index.ts';
import { adapterVersions } from '../../../packages/agents/src/build.ts';

export const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
export async function bundleMetadata() {
  const pkg = await readJson(resolve(desktop, 'package.json'));
  const bundleVersion = process.env.SKARO_BUNDLE_VERSION ?? pkg.version;
  const skaroVersion = process.env.SKARO_PRODUCT_VERSION ?? bundleVersion;
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!stable.test(bundleVersion) || !stable.test(skaroVersion))
    throw new Error('Stable bundle and product versions are required');
  const agents = Object.fromEntries(
    RELEASE_AGENT_IDS.map((id) => {
      const pkg = agentPackage(id);
      return [id, { version: pkg.version, shownVersion: pkg.shownVersion }];
    }),
  );
  return {
    bundleVersion,
    skaroVersion,
    ...legacyBundlePins(agents),
    adapters: await adapterVersions(),
    agents,
  };
}
export async function writeBundleMetadata() {
  const bundle = await bundleMetadata();
  await mkdir(resolve(desktop, 'build'), { recursive: true });
  await writeFile(
    resolve(desktop, 'build/skaro-bundle.json'),
    JSON.stringify(bundle, null, 2) + '\n',
  );
  return bundle;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await writeBundleMetadata();
