import { NPM_INSTALL_FILE_LIMIT } from './managed-npm-tar';
import type { PnpmGraphFacts } from './managed-pnpm-graph-facts';
import {
  pnpmBaseIdentity,
  pnpmDependencyPath,
  pnpmGraphReferences,
  pnpmPhysicalPackageRoot,
  type PnpmGraphReference,
} from './managed-pnpm-graph-topology';
import { pnpmLockTarballs, pnpmRecord } from './managed-pnpm-lock';
import { assertPnpmResolutionScopes } from './managed-pnpm-resolution-scopes';

export type PnpmInstalledNode =
  | { type: 'directory' }
  | { type: 'link'; target: string }
  | { type: 'file'; digest: string; manifestId?: string; targets?: readonly string[] };
export type PnpmInstalledInventory = ReadonlyMap<string, PnpmInstalledNode>;
const incomplete = (reason: string): never => {
  throw new Error(`managed_pnpm_graph_${reason}`);
};

/** A successful SDK exit is insufficient: check the original lock graph against observed private nodes. */
export function assertPnpmInstalledGraph(
  lock: Record<string, unknown>,
  facts: PnpmGraphFacts,
  inventory: PnpmInstalledInventory,
  windows = process.platform === 'win32',
) {
  pnpmLockTarballs(lock);
  if (inventory.size > NPM_INSTALL_FILE_LIMIT) incomplete('node_limit');
  const key = (path: string) => (windows ? path.toLowerCase() : path);
  const nodes = new Map<string, PnpmInstalledNode>();
  for (const [path, node] of inventory) {
    if (nodes.has(key(path))) incomplete('case_collision');
    nodes.set(key(path), node);
  }
  const snapshots = pnpmRecord(lock.snapshots),
    snapshotRoots = new Map<string, string>(),
    rootSnapshots = new Map<string, string>(),
    expectedLinks = new Set<string>(),
    expectedBins = new Set<string>(),
    pending: { id: string; root: string }[] = [];

  function bind(reference: PnpmGraphReference, path: string) {
    const link = nodes.get(key(path));
    if (!link) {
      if (reference.optional) return undefined;
      return incomplete('required_dependency_missing');
    }
    if (link.type !== 'link') return incomplete('dependency_not_link');
    expectedLinks.add(key(path));
    const root = link.target,
      { base, name } = pnpmBaseIdentity(reference.id);
    if (
      !Object.hasOwn(snapshots, reference.id) ||
      !pnpmPhysicalPackageRoot(root) ||
      !root.endsWith(`/node_modules/${name}`) ||
      nodes.get(key(root))?.type !== 'directory'
    )
      return incomplete('package_target_invalid');
    const manifest = nodes.get(key(`${root}/package.json`)),
      fact = facts.get(base);
    if (
      !fact ||
      manifest?.type !== 'file' ||
      manifest.manifestId !== base ||
      manifest.digest !== fact.manifestDigest
    )
      return incomplete('package_identity_changed');
    const previousRoot = snapshotRoots.get(reference.id),
      previousId = rootSnapshots.get(key(root));
    if (
      (previousRoot && key(previousRoot) !== key(root)) ||
      (previousId && previousId !== reference.id)
    )
      return incomplete('peer_context_changed');
    if (!previousRoot) {
      snapshotRoots.set(reference.id, root);
      rootSnapshots.set(key(root), reference.id);
      pending.push({ id: reference.id, root });
    }
    return { id: reference.id, root };
  }

  function scope(references: PnpmGraphReference[], path: (name: string) => string, bins: string) {
    const commands = new Map<string, { target: string; id: string }>();
    for (const reference of references) {
      const resolved = bind(reference, path(reference.name));
      if (!resolved) continue;
      const fact = facts.get(pnpmBaseIdentity(reference.id).base)!;
      for (const bin of fact.bins) {
        const target = `${resolved.root}/${bin.target}`,
          previous = commands.get(key(bin.command));
        if (previous && (previous.target !== target || previous.id !== reference.id))
          incomplete('bin_conflict');
        if (nodes.get(key(target))?.type !== 'file') incomplete('bin_target_missing');
        commands.set(key(bin.command), { target, id: reference.id });
        for (const suffix of windows ? ['', '.cmd', '.ps1'] : ['']) {
          const shimPath = key(`${bins}/${bin.command}${suffix}`),
            shim = nodes.get(shimPath);
          if (
            shim?.type !== 'file' ||
            !shim.targets ||
            shim.targets.length !== 1 ||
            key(shim.targets[0]!) !== key(target)
          )
            incomplete('bin_missing_or_changed');
          expectedBins.add(shimPath);
        }
      }
    }
  }
  scope(pnpmGraphReferences(pnpmRecord(lock.importers)['.'], true), (name) => name, '.bin');
  for (let index = 0; index < pending.length; index++) {
    if (pending.length > NPM_INSTALL_FILE_LIMIT) incomplete('node_limit');
    const { id, root } = pending[index]!,
      { name } = pnpmBaseIdentity(id);
    scope(
      pnpmGraphReferences(snapshots[id]),
      (alias) => pnpmDependencyPath(root, alias, name),
      `${root}/node_modules/.bin`,
    );
  }
  for (const [path, node] of inventory) {
    if (node.type === 'link' && !expectedLinks.has(key(path))) incomplete('unexpected_link');
    if (node.type === 'directory' && pnpmPhysicalPackageRoot(path) && !rootSnapshots.has(key(path)))
      incomplete('unexpected_package');
    if (node.type === 'file' && path.split('/').includes('.bin') && !expectedBins.has(key(path)))
      incomplete('unexpected_bin');
  }
  assertPnpmResolutionScopes(inventory, snapshotRoots, expectedLinks, expectedBins, windows);
  return { snapshots: snapshotRoots.size, links: expectedLinks.size, shims: expectedBins.size };
}
