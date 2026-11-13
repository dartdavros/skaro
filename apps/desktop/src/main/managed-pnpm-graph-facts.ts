import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalCachePath, readCacheFile } from './managed-cache-files';
import { npmArchiveBins, type NpmArchiveBin } from './managed-npm-archive-bin';
import { NPM_INSTALL_FILE_LIMIT } from './managed-npm-tar';
import { pnpmLockTarballs, pnpmRecord } from './managed-pnpm-lock';

export const PNPM_GRAPH_FILE = 'pnpm-graph.json';
export interface PnpmGraphFact {
  manifestDigest: string;
  bins: readonly NpmArchiveBin[];
}
export type PnpmGraphFacts = ReadonlyMap<string, PnpmGraphFact>;
function invalid(): never {
  throw new Error('managed_pnpm_graph_facts_invalid');
}

/** Only integrity-verified archive manifests may create these facts; installed files are not authority. */
export function validatePnpmGraphFacts(
  lock: Record<string, unknown>,
  input: unknown,
): PnpmGraphFacts {
  pnpmLockTarballs(lock);
  const document = pnpmRecord(input);
  if (document.version !== 1 || Object.keys(document).length !== 2) invalid();
  const packages = pnpmRecord(document.packages),
    ids = Object.keys(pnpmRecord(lock.packages));
  if (Object.keys(packages).length !== ids.length) invalid();
  const facts = new Map<string, PnpmGraphFact>();
  let bins = 0;
  for (const id of ids) {
    if (!Object.hasOwn(packages, id)) invalid();
    const fact = pnpmRecord(packages[id]);
    if (
      Object.keys(fact).length !== 2 ||
      typeof fact.manifestDigest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(fact.manifestDigest) ||
      !Array.isArray(fact.bins)
    )
      invalid();
    bins += fact.bins.length;
    if (bins > NPM_INSTALL_FILE_LIMIT) invalid();
    const commands = new Map<string, string>();
    for (const raw of fact.bins) {
      const bin = pnpmRecord(raw);
      if (
        Object.keys(bin).length !== 2 ||
        typeof bin.command !== 'string' ||
        typeof bin.target !== 'string' ||
        commands.has(bin.command)
      )
        invalid();
      commands.set(bin.command, bin.target);
    }
    const validated = npmArchiveBins(
      Buffer.from(JSON.stringify({ bin: Object.fromEntries(commands) })),
    );
    if (validated.some((bin) => bin.target !== commands.get(bin.command))) invalid();
    facts.set(id, { manifestDigest: fact.manifestDigest, bins: validated });
  }
  return facts;
}

export function encodePnpmGraphFacts(lock: Record<string, unknown>, facts: PnpmGraphFacts) {
  const document = { version: 1, packages: Object.fromEntries(facts) };
  validatePnpmGraphFacts(lock, document);
  const bytes = Buffer.from(JSON.stringify(document));
  if (bytes.length > 16 * 1024 ** 2) invalid();
  return bytes;
}

export async function writePnpmGraphFacts(root: string, path: string, bytes: Buffer) {
  const file = await canonicalCachePath(root, join(path, PNPM_GRAPH_FILE), true);
  await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
}

export async function readPnpmGraphFacts(
  root: string,
  path: string,
  lock: Record<string, unknown>,
) {
  const { data } = await readCacheFile(root, join(path, PNPM_GRAPH_FILE), 16 * 1024 ** 2);
  return validatePnpmGraphFacts(lock, JSON.parse(data.toString('utf8')));
}

export function pnpmManifestIdentity(bytes: Buffer) {
  if (!bytes.length || bytes.length > 1024 ** 2) invalid();
  const manifest = pnpmRecord(JSON.parse(bytes.toString('utf8')));
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') invalid();
  return {
    id: `${manifest.name}@${manifest.version}`,
    digest: createHash('sha256').update(bytes).digest('hex'),
  };
}
