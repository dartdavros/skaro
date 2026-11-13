import { npmArchivePath } from './managed-npm-archive';
import { UnsupportedDependencyCache } from './managed-dependency-provenance';

type NodeType = 'directory' | 'file' | 'link';
interface InstallNode {
  path: string;
  type: NodeType;
  source: string;
}
export function unsupportedPnpmExpansion(): never {
  throw new UnsupportedDependencyCache('managed_dependencies_unsupported_archive_expansion');
}

/** Bounded, case-sensitive-on-case-folded-keys union; links are leaves, never traversed. */
export class PnpmInstallNodes {
  private readonly nodes: Map<string, InstallNode>;
  private readonly limit: number;

  constructor(limit: number, initial?: PnpmInstallNodes) {
    if (!Number.isSafeInteger(limit) || limit < 1) unsupportedPnpmExpansion();
    this.limit = limit;
    this.nodes = new Map(initial?.nodes);
    if (this.nodes.size > limit) unsupportedPnpmExpansion();
  }

  get size() {
    return this.nodes.size;
  }

  add(path: string, type: NodeType, source: string) {
    // Same portable path contract as tar payloads, without treating a suffix as its type.
    npmArchivePath(`package${path ? `/${path}` : ''}`, type === 'directory' ? 53 : 48);
    const parts = path ? path.split('/') : [];
    this.node('', 'directory', 'root');
    for (let length = 1; length < parts.length; length++)
      this.node(parts.slice(0, length).join('/'), 'directory', 'parent');
    this.node(path, type, source);
  }

  private node(path: string, type: NodeType, source: string) {
    const key = path.toLowerCase(),
      previous = this.nodes.get(key);
    if (previous) {
      if (
        previous.path !== path ||
        previous.type !== type ||
        (type !== 'directory' && previous.source !== source)
      )
        unsupportedPnpmExpansion();
      return;
    }
    if (this.nodes.size >= this.limit) unsupportedPnpmExpansion();
    this.nodes.set(key, { path, type, source });
  }
}
