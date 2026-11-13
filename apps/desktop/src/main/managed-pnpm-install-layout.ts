import { isDeepStrictEqual } from 'node:util';
import type { NpmArchivePayloadNode } from './managed-npm-archive-nodes';
import { pnpmLockTarballs, pnpmRecord } from './managed-pnpm-lock';
import {
  PnpmInstallNodes,
  unsupportedPnpmExpansion as unsupported,
} from './managed-pnpm-install-nodes';

export interface PnpmPackageExpansion {
  nodes: ReadonlyArray<Readonly<NpmArchivePayloadNode>>;
  bytes: number;
  /** Command names from the inspected, validated package.json bin field (not lock hasBin). */
  bins: readonly string[];
}
interface Snapshot {
  id: string;
  packageId: string;
  root: string;
  dependencies: Map<string, string>;
}
interface BinScope {
  path: string;
  dependencies: Map<string, string>;
}
function references(value: unknown, limit: number, importer = false) {
  const refs = new Map<string, string>(),
    record = pnpmRecord(value);
  for (const group of [
    'dependencies',
    ...(importer ? ['devDependencies'] : []),
    'optionalDependencies',
  ]) {
    if (record[group] === undefined) continue;
    for (const [name, raw] of Object.entries(pnpmRecord(record[group]))) {
      const version = importer ? pnpmRecord(raw).version : raw;
      if (typeof version !== 'string') unsupported();
      const id = `${name}@${version}`,
        previous = refs.get(name);
      if (previous !== undefined && previous !== id) unsupported();
      if (previous === undefined && refs.size >= limit) unsupported();
      refs.set(name, id);
    }
  }
  return refs;
}

/** Original-lock topology + verified archive facts. No pnpm execution or filesystem effects. */
export class PnpmInstallLayout {
  private readonly nodeLimit: number;
  private readonly byteLimit: number;
  private readonly base: PnpmInstallNodes;
  private readonly packages: string[];
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly scopes: BinScope[] = [];
  private readonly facts = new Map<string, PnpmPackageExpansion>();

  constructor(input: unknown, nodeLimit: number, byteLimit: number) {
    if (!Number.isSafeInteger(byteLimit) || byteLimit < 1) unsupported();
    pnpmLockTarballs(input); // Existing registry/alias/reference/peer-context admission contract.
    const lock = pnpmRecord(input);
    this.nodeLimit = nodeLimit;
    this.byteLimit = byteLimit;
    this.packages = Object.keys(pnpmRecord(lock.packages));
    this.base = new PnpmInstallNodes(nodeLimit);
    this.base.add('', 'directory', 'root');
    this.base.add('.pnpm', 'directory', 'virtual-store');
    for (const path of ['.modules.yaml', '.pnpm/lock.yaml', '.pnpm-workspace-state.json'])
      this.base.add(path, 'file', 'metadata');

    for (const [id, raw] of Object.entries(pnpmRecord(lock.snapshots))) {
      const packageId = id.split('(')[0]!,
        name = packageId.slice(0, packageId.lastIndexOf('@')),
        // Separate opaque containers preserve peer multiplicity without reimplementing pnpm hashes.
        modules = `.pnpm/${this.snapshots.size}/node_modules`,
        root = `${modules}/${name}`;
      this.base.add(root, 'directory', 'package-root');
      this.snapshots.set(id, { id, packageId, root, dependencies: references(raw, nodeLimit) });
    }
    for (const snapshot of this.snapshots.values()) {
      const name = snapshot.packageId.slice(0, snapshot.packageId.lastIndexOf('@')),
        modules = snapshot.root.slice(0, -(name.length + 1));
      for (const [alias, target] of snapshot.dependencies) {
        if (!this.snapshots.has(target)) unsupported();
        const parent = alias === name ? `${snapshot.root}/node_modules` : modules;
        this.base.add(`${parent}/${alias}`, 'link', target);
      }
      this.scopes.push({
        path: `${snapshot.root}/node_modules/.bin`,
        dependencies: snapshot.dependencies,
      });
    }
    const importer = references(pnpmRecord(lock.importers)['.'], nodeLimit, true);
    for (const [alias, target] of importer) {
      if (!this.snapshots.has(target)) unsupported();
      this.base.add(alias, 'link', target);
    }
    this.scopes.push({ path: '.bin', dependencies: importer });
  }

  /** Facts are committed only after the entire candidate layout still fits. */
  register(packageId: string, input: PnpmPackageExpansion) {
    if (!this.packages.includes(packageId)) unsupported();
    const previous = this.facts.get(packageId);
    if (previous) {
      if (!isDeepStrictEqual(previous, input)) unsupported();
      return this.snapshot();
    }
    if (
      !Number.isSafeInteger(input.bytes) ||
      input.bytes < 0 ||
      !input.nodes.length ||
      input.nodes.length > this.nodeLimit ||
      input.bins.length > this.nodeLimit
    )
      unsupported();
    const paths = new Set<string>();
    for (const node of input.nodes) {
      if (typeof node.directory !== 'boolean' || paths.has(node.path.toLowerCase())) unsupported();
      paths.add(node.path.toLowerCase());
    }
    if (!input.nodes.some((node) => node.path === '' && node.directory)) unsupported();
    const commands = new Set<string>();
    for (const bin of input.bins) {
      if (!/^[a-zA-Z0-9._-]{1,100}$/.test(bin) || commands.has(bin.toLowerCase())) unsupported();
      commands.add(bin.toLowerCase());
    }
    const facts: PnpmPackageExpansion = {
      nodes: input.nodes.map((node) => ({ ...node })),
      bytes: input.bytes,
      bins: [...input.bins],
    };
    const candidate = new Map(this.facts);
    candidate.set(packageId, facts);
    const result = this.measure(candidate);
    this.facts.set(packageId, facts);
    return result;
  }

  snapshot() {
    return this.measure(this.facts);
  }

  assertComplete() {
    const result = this.snapshot();
    if (!result.complete) unsupported();
    return result;
  }

  private measure(facts: ReadonlyMap<string, PnpmPackageExpansion>) {
    const tree = new PnpmInstallNodes(this.nodeLimit, this.base);
    let payloadBytes = 0,
      shimFiles = 0;
    for (const snapshot of this.snapshots.values()) {
      const fact = facts.get(snapshot.packageId);
      if (!fact) continue;
      payloadBytes += fact.bytes;
      if (!Number.isSafeInteger(payloadBytes) || payloadBytes > this.byteLimit) unsupported();
      for (const node of fact.nodes)
        tree.add(
          `${snapshot.root}${node.path ? `/${node.path}` : ''}`,
          node.directory ? 'directory' : 'file',
          `payload:${snapshot.id}`,
        );
    }
    for (const scope of this.scopes) {
      const commands = new Map<string, { name: string; provider: string }>();
      for (const target of scope.dependencies.values()) {
        const snapshot = this.snapshots.get(target)!;
        for (const name of facts.get(snapshot.packageId)?.bins ?? []) {
          const key = name.toLowerCase(),
            previous = commands.get(key);
          if (previous && (previous.name !== name || previous.provider !== target)) unsupported();
          commands.set(key, { name, provider: target });
        }
      }
      for (const { name, provider } of commands.values()) {
        tree.add(scope.path, 'directory', 'bin-directory');
        for (const suffix of ['', '.cmd', '.ps1']) {
          tree.add(`${scope.path}/${name}${suffix}`, 'file', `shim:${provider}:${name}:${suffix}`);
          shimFiles++;
        }
      }
    }
    // Final physical validation limits each generated shim to 64 KiB; metadata reserve stays separate.
    const shimBytes = shimFiles * 64 * 1024,
      expandedBytes = payloadBytes + shimBytes;
    if (!Number.isSafeInteger(expandedBytes) || expandedBytes > this.byteLimit) unsupported();
    const missingPackageIds = this.packages.filter((id) => !facts.has(id));
    return {
      nodes: tree.size,
      payloadBytes,
      shimFiles,
      shimBytes,
      expandedBytes,
      complete: missingPackageIds.length === 0,
      missingPackageIds,
      metadataFiles: 3,
    };
  }
}
