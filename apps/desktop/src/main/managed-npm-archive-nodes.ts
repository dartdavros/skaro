import { UnsupportedDependencyCache } from './managed-dependency-provenance';

/** Portability/checksum validation belongs to the caller's npm tar-header decoder. */
export interface ValidatedNpmArchiveNode {
  root: string;
  path: string;
  directory: boolean;
}
export interface NpmArchivePayloadNode {
  path: string;
  directory: boolean;
}
function unsupported(): never {
  throw new UnsupportedDependencyCache('managed_dependencies_unsupported_archive_expansion');
}

/** Unique payload nodes, including one package root; no extraction or layout/bin accounting. */
export class NpmArchiveNodes {
  private readonly limit: number;
  private readonly nodes = new Map<string, NpmArchivePayloadNode>();
  private readonly entries = new Set<string>();
  private root?: string;

  /** Pass the existing install-node limit, or a smaller remaining payload allowance. */
  constructor(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) unsupported();
    this.limit = limit;
  }

  get size() {
    return this.nodes.size;
  }

  /** Detached facts for a graph planner; callers cannot mutate this tracker's inventory. */
  inventory(): ReadonlyArray<Readonly<NpmArchivePayloadNode>> {
    return [...this.nodes.values()].map((node) => ({ ...node }));
  }

  /** A rejected entry never changes either bounded collection or the selected root. */
  add(entry: ValidatedNpmArchiveNode): { nodes: number; delta: number } {
    if (
      typeof entry.directory !== 'boolean' ||
      !entry.root ||
      entry.root.includes('/') ||
      (this.root !== undefined && this.root !== entry.root) ||
      (!entry.directory && entry.path.endsWith('/'))
    )
      unsupported();
    const parts = entry.path.replace(/\/$/, '').split('/');
    if (
      parts[0] !== entry.root ||
      parts.some((part) => !part || part === '.' || part === '..') ||
      (parts.length === 1 && !entry.directory)
    )
      unsupported();
    const relative = parts.slice(1).join('/'),
      key = relative.toLowerCase();
    if (this.entries.has(key)) unsupported();

    const pending = new Map<string, NpmArchivePayloadNode>();
    const node = (path: string, directory: boolean) => {
      const key = path.toLowerCase(),
        previous = this.nodes.get(key) ?? pending.get(key);
      if (previous) {
        if (previous.path !== path || previous.directory !== directory) unsupported();
        return;
      }
      if (this.nodes.size + pending.size >= this.limit) unsupported();
      pending.set(key, { path, directory });
    };
    node('', true);
    for (let length = 2; length < parts.length; length++)
      node(parts.slice(1, length).join('/'), true);
    node(relative, entry.directory);

    // Every explicit entry names a unique node, so entries.size is bounded by nodes.size.
    for (const [key, value] of pending) this.nodes.set(key, value);
    this.entries.add(key);
    this.root = entry.root;
    return { nodes: this.nodes.size, delta: pending.size };
  }
}
