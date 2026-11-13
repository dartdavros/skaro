import { pnpmRecord } from './managed-pnpm-lock';

export interface PnpmGraphReference {
  name: string;
  id: string;
  optional: boolean;
}
export function pnpmGraphReferences(value: unknown, importer = false): PnpmGraphReference[] {
  const record = pnpmRecord(value),
    references = new Map<string, PnpmGraphReference>();
  for (const group of [
    'dependencies',
    ...(importer ? ['devDependencies'] : []),
    'optionalDependencies',
  ]) {
    for (const [name, raw] of Object.entries(pnpmRecord(record[group] ?? {}))) {
      const version = importer ? pnpmRecord(raw).version : raw;
      if (typeof version !== 'string') throw new Error('managed_pnpm_graph_reference_invalid');
      const id = `${name}@${version}`,
        previous = references.get(name);
      if (previous && previous.id !== id) throw new Error('managed_pnpm_graph_reference_conflict');
      references.set(name, { name, id, optional: group === 'optionalDependencies' });
    }
  }
  return [...references.values()];
}

export function pnpmBaseIdentity(id: string) {
  const base = id.split('(')[0]!,
    at = base.lastIndexOf('@');
  return { base, name: base.slice(0, at) };
}

/** Peer hashes remain opaque. The graph traversal binds each snapshot to exactly one physical container. */
export function pnpmPhysicalPackageRoot(path: string) {
  return /^\.pnpm\/[^/]+\/node_modules\/(?:@[^/]+\/[^/]+|[^@/][^/]*)$/.test(path);
}
export function pnpmDependencyPath(root: string, name: string, ownName: string) {
  const modules = root.slice(0, -(ownName.length + 1));
  return `${name === ownName ? `${root}/node_modules` : modules}/${name}`;
}
