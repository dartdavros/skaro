import { createHash } from 'node:crypto';
import { constants, type BigIntStats, type Stats } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readlink,
  readdir,
  realpath,
  rmdir,
  statfs,
  unlink,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { canonicalCachePath } from './managed-cache-files';
import {
  encodeNativeIdentity,
  pnpmTargetMatches,
  sameNativeIdentity,
  sameNativeObservation,
  type PnpmTargetIdentity,
} from './managed-native-identity';
export type { PnpmTargetIdentity } from './managed-native-identity';
import { NPM_INSTALL_BYTE_LIMIT, NPM_INSTALL_FILE_LIMIT } from './managed-npm-archive';
import { verifyPnpmShim } from './managed-pnpm-shims';
import { assertPnpmInstalledGraph, type PnpmInstalledNode } from './managed-pnpm-completeness';
import { pnpmManifestIdentity, type PnpmGraphFacts } from './managed-pnpm-graph-facts';
import { pnpmPhysicalPackageRoot } from './managed-pnpm-graph-topology';

/** Number Stats supply budgets/legacy display only; native IDs are always bigint. */
async function observe(path: string) {
  const native = await lstat(path, { bigint: true });
  const info = await lstat(path);
  if (!sameNativeObservation(native, await lstat(path, { bigint: true })))
    throw new Error('managed_pnpm_layout_changed');
  return { info, native };
}
/** Bind the opened handle to the captured node as well as checking the pathname after reading. */
async function readPnpmFile(cwd: string, path: string, expected: BigIntStats, limit: number) {
  await canonicalCachePath(cwd, path);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat({ bigint: true });
    if (
      !sameNativeObservation(expected, before) ||
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size < 0n ||
      before.size > BigInt(limit)
    )
      throw new Error('managed_pnpm_layout_changed');
    const data = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await file.read(data, offset, data.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (
      BigInt(offset) !== before.size ||
      !sameNativeObservation(before, await file.stat({ bigint: true }))
    )
      throw new Error('managed_pnpm_layout_changed');
    return { data: data.subarray(0, offset) };
  } finally {
    await file.close();
  }
}
const plain = (path: string) => path.replace(/^\\\\\?\\/, '');
export function pnpmPrivatePath(root: string, path: string) {
  const child = relative(resolve(root), resolve(plain(path)));
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child))
    throw new Error('managed_pnpm_layout_external_target');
  return resolve(plain(path));
}
export async function emptyPnpmTarget(cwd: string) {
  if (cwd.length > 1024) throw new Error('managed_pnpm_install_path_unsupported');
  const path = await canonicalCachePath(cwd, join(cwd, 'node_modules'), true);
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const fs = await statfs(cwd);
    if (fs.bsize < 1 || fs.bsize > 65536)
      throw new Error('managed_dependencies_unsupported_allocation_unit', { cause: error });
    return path;
  }
  throw new Error('managed_dependencies_existing_node_modules_retained');
}
export async function createPnpmTarget(cwd: string): Promise<PnpmTargetIdentity> {
  const path = await emptyPnpmTarget(cwd);
  await mkdir(path, { mode: 0o700 });
  await canonicalCachePath(cwd, path);
  const { info, native } = await observe(path);
  if (!native.isDirectory() || native.isSymbolicLink())
    throw new Error('managed_pnpm_target_identity_changed');
  // Prepare the REAL declared virtual store, not a marker/manifest. pnpm's normal prune removes
  // an EMPTY project modules root; this existing physical child preserves our original native pin.
  const virtualStore = join(path, '.pnpm');
  await canonicalCachePath(cwd, virtualStore, true);
  await mkdir(virtualStore, { mode: 0o700 });
  await canonicalCachePath(cwd, virtualStore);
  const prepared = await lstat(virtualStore, { bigint: true });
  if (
    !prepared.isDirectory() ||
    prepared.isSymbolicLink() ||
    !sameNativeIdentity(native, await lstat(path, { bigint: true }))
  )
    throw new Error('managed_pnpm_target_identity_changed');
  return {
    path,
    dev: info.dev,
    ino: info.ino,
    birthtimeMs: info.birthtimeMs,
    nativeIdentity: encodeNativeIdentity(native),
  };
}
/** Private install layout only. CAS verification/deletion remains regular-file-only and unchanged. */
export async function pnpmNodeModules(
  cwd: string,
  target: string,
  created?: PnpmTargetIdentity,
  verification?: { lock: Record<string, unknown>; facts: PnpmGraphFacts },
) {
  await canonicalCachePath(cwd, target);
  const initial = await lstat(target, { bigint: true });
  if (!initial.isDirectory() || (created && !pnpmTargetMatches(created, target, initial)))
    throw new Error('managed_pnpm_target_identity_changed');
  const nodes = new Map<
    string,
    { info: Stats; native: BigIntStats; children?: string[]; link?: string }
  >();
  const records: unknown[] = [],
    inventory = new Map<string, PnpmInstalledNode>();
  const portable = (path: string) => relative(target, path).split(sep).join('/');
  let bytes = 0;
  async function walk(path: string): Promise<void> {
    // Only a physical parent's ancestors are traversed; link leaves are never enumerated.
    await canonicalCachePath(cwd, dirname(path));
    const { info, native } = await observe(path),
      rel = portable(path);
    if (path === target && !sameNativeIdentity(initial, native))
      throw new Error('managed_pnpm_target_identity_changed');
    if (nodes.size >= NPM_INSTALL_FILE_LIMIT) throw new Error('managed_pnpm_layout_node_limit');
    if (native.isSymbolicLink()) {
      const link = await readlink(path);
      pnpmPrivatePath(target, resolve(dirname(path), plain(link)));
      const resolved = pnpmPrivatePath(target, await realpath(path));
      inventory.set(rel, { type: 'link', target: portable(resolved) });
      nodes.set(path, { info, native, link });
      records.push([rel, 'link', link]);
    } else if (native.isDirectory()) {
      const children = (await readdir(path)).sort();
      inventory.set(rel, { type: 'directory' });
      nodes.set(path, { info, native, children });
      for (const child of children) await walk(join(path, child));
    } else if (native.isFile() && native.nlink === 1n) {
      bytes += info.size;
      if (bytes > NPM_INSTALL_BYTE_LIMIT) throw new Error('managed_pnpm_layout_byte_limit');
      const shim = rel.split('/').includes('.bin'),
        manifest =
          !!verification &&
          rel.endsWith('/package.json') &&
          pnpmPhysicalPackageRoot(rel.slice(0, -'/package.json'.length));
      const file = await readPnpmFile(
        cwd,
        path,
        native,
        shim ? 64 * 1024 : manifest ? 1024 ** 2 : NPM_INSTALL_BYTE_LIMIT,
      );
      const targets = shim
        ? (await verifyPnpmShim(target, path, file.data)).map(portable)
        : undefined;
      const digest = createHash('sha256').update(file.data).digest('hex');
      inventory.set(rel, {
        type: 'file',
        digest,
        ...(targets ? { targets } : {}),
        ...(manifest ? { manifestId: pnpmManifestIdentity(file.data).id } : {}),
      });
      records.push([rel, info.size, digest]);
      nodes.set(path, { info, native });
    } else throw new Error('managed_pnpm_layout_non_private_file');
    const after = await lstat(path, { bigint: true });
    if (!sameNativeObservation(native, after)) throw new Error('managed_pnpm_layout_changed');
  }
  await walk(target);
  if (verification) assertPnpmInstalledGraph(verification.lock, verification.facts, inventory);
  return {
    bytes,
    nodes,
    digest: createHash('sha256').update(JSON.stringify(records)).digest('hex'),
  };
}
/** Remove observed private links as leaves; never recurse through their targets. */
export async function removePnpmNodeModules(
  cwd: string,
  target: string,
  created: PnpmTargetIdentity,
) {
  if (resolve(cwd) === resolve(target)) throw new Error('managed_pnpm_root_deletion_forbidden');
  const tree = await pnpmNodeModules(cwd, target, created);
  async function remove(path: string): Promise<void> {
    const node = tree.nodes.get(path)!;
    await canonicalCachePath(cwd, dirname(path));
    const native = await lstat(path, { bigint: true });
    if (!sameNativeObservation(node.native, native)) throw new Error('managed_pnpm_layout_changed');
    if (node.children) {
      await canonicalCachePath(cwd, path);
      if (JSON.stringify((await readdir(path)).sort()) !== JSON.stringify(node.children))
        throw new Error('managed_pnpm_layout_changed');
      for (const child of node.children) await remove(join(path, child));
      if (!sameNativeIdentity(node.native, await lstat(path, { bigint: true })))
        throw new Error('managed_pnpm_layout_changed');
      await rmdir(path);
    } else {
      if (node.link !== undefined && (await readlink(path)) !== node.link)
        throw new Error('managed_pnpm_layout_changed');
      if (!sameNativeObservation(node.native, await lstat(path, { bigint: true })))
        throw new Error('managed_pnpm_layout_changed');
      await unlink(path);
    }
  }
  await remove(target);
  return tree.bytes;
}
