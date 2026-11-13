import type { BigIntStats } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { cacheTree } from './managed-cache-files';

type Observation = Awaited<ReturnType<typeof cacheTree>>;
interface NativeNode {
  directory: boolean;
  dev: bigint;
  ino: bigint;
  birthtimeNs: bigint;
  size: bigint;
  mtimeNs: bigint;
  nlink: bigint;
  digest?: string;
  remaining?: Set<string>;
}
const fail = (): never => {
  throw new Error('managed_cache_removal_inventory_changed');
};

/** Detached native inventory. Only successful own deletions may shrink its expected children. */
export class CacheRemovalPlan {
  private readonly target: string;
  private readonly nodes = new Map<string, NativeNode>();

  constructor(target: string, observed: Observation) {
    this.target = resolve(target);
    const files = new Map(observed.files.map((file) => [file.path, file]));
    for (const [path, node] of observed.nodes) {
      const child = relative(this.target, path);
      if (
        path !== resolve(path) ||
        child === '..' ||
        child.startsWith(`..${sep}`) ||
        isAbsolute(child)
      )
        fail();
      const info = node.native,
        directory = info.isDirectory();
      if (info.isSymbolicLink() || (!directory && (!info.isFile() || info.nlink !== 1n))) fail();
      const file = files.get(child.split(sep).join('/'));
      if ((!directory && (!file || BigInt(file.bytes) !== info.size)) || (directory && file))
        fail();
      if (directory !== (node.children !== undefined)) fail();
      if (
        node.children &&
        (new Set(node.children).size !== node.children.length ||
          node.children.some(
            (name) => !name || name === '.' || name === '..' || /[/\\]/.test(name),
          ))
      )
        fail();
      this.nodes.set(path, {
        directory,
        dev: info.dev,
        ino: info.ino,
        birthtimeNs: info.birthtimeNs,
        size: info.size,
        mtimeNs: info.mtimeNs,
        nlink: info.nlink,
        ...(file ? { digest: file.digest } : {}),
        ...(node.children ? { remaining: new Set(node.children) } : {}),
      });
    }
    if (!this.nodes.has(this.target)) fail();
    for (const [path, node] of this.nodes) {
      if (path !== this.target && !this.nodes.get(dirname(path))?.remaining?.has(basename(path)))
        fail();
      for (const child of node.remaining ?? []) if (!this.nodes.has(join(path, child))) fail();
    }
    if (files.size !== [...this.nodes.values()].filter((node) => !node.directory).length) fail();
  }

  /** Every ancestor inside the captured root is checked, not merely canonical pathname ancestry. */
  lineage(path: string) {
    if (!this.nodes.has(path)) return fail();
    const result = [path];
    while (path !== this.target) {
      path = dirname(path);
      result.unshift(path);
    }
    return result;
  }

  assertNative(path: string, info: BigIntStats) {
    const node = this.nodes.get(path);
    if (
      !node ||
      info.isSymbolicLink() ||
      info.dev !== node.dev ||
      info.ino !== node.ino ||
      info.birthtimeNs !== node.birthtimeNs ||
      info.isDirectory() !== node.directory ||
      (!node.directory &&
        (!info.isFile() ||
          info.nlink !== 1n ||
          info.size !== node.size ||
          info.mtimeNs !== node.mtimeNs))
    )
      fail();
  }

  assertChildren(path: string, children: readonly string[]) {
    const expected = this.nodes.get(path)?.remaining;
    if (
      !expected ||
      children.length !== expected.size ||
      children.some((name) => !expected.has(name))
    )
      fail();
  }

  children(path: string): string[] | undefined {
    const node = this.nodes.get(path);
    if (!node) return fail();
    return node.remaining ? [...node.remaining] : undefined;
  }

  digest(path: string) {
    const digest = this.nodes.get(path)?.digest;
    if (!digest) return fail();
    return digest;
  }

  /** Call only after this exact node's syscall succeeds; unexpected loss is not silently adopted. */
  removed(path: string) {
    const node = this.nodes.get(path);
    if (!node || node.remaining?.size) fail();
    if (path !== this.target && !this.nodes.get(dirname(path))?.remaining?.delete(basename(path)))
      fail();
    this.nodes.delete(path);
  }
}
