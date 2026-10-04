// Build metadata from the real source pins and dependency manifests, never npm latest.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { agentPackage, AGENT_PINS } from '../../../packages/core/src/agents/pins.ts';

export const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
export async function bundleMetadata() {
  const pkg = await readJson(resolve(desktop, 'package.json'));
  const claude = await readJson(resolve(desktop, '../../packages/adapter-claude/package.json'));
  const codex = await readJson(resolve(desktop, '../../packages/adapter-codex/package.json'));
  if (claude.dependencies['@anthropic-ai/claude-agent-sdk'] !== AGENT_PINS['claude-code'])
    throw new Error('Claude SDK dependency must exactly match the release pin');
  const bundleVersion = process.env.SKARO_BUNDLE_VERSION ?? pkg.version;
  const skaroVersion = process.env.SKARO_PRODUCT_VERSION ?? bundleVersion;
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!stable.test(bundleVersion) || !stable.test(skaroVersion))
    throw new Error('Stable bundle and product versions are required');
  const agents = Object.fromEntries(
    ['codex', 'claude-code'].map((id) => {
      const pkg = agentPackage(id);
      return [id, { version: pkg.version, shownVersion: pkg.shownVersion }];
    }),
  );
  return {
    bundleVersion,
    skaroVersion,
    claudeSdk: AGENT_PINS['claude-code'],
    adapters: { codex: codex.version, 'claude-code': claude.version },
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
