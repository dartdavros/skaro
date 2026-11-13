import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { encodeNativeIdentity, sameNativeObservation } from './managed-native-identity';
import {
  ARCHIVE_LIMITS,
  ARCHIVE_ROLES,
  fail,
  manifestText,
  nodeKey,
  validateManifest,
  validateRoots,
  type ArchiveManifest,
  type ArchiveNode,
  type ArchiveRoots,
} from './managed-verification-archive-metadata';
import {
  absent,
  canonicalDirectory,
  linkObservation,
  nodePath,
} from './managed-verification-archive-paths';

export function observation(info: BigIntStats) {
  return {
    native: encodeNativeIdentity(info),
    size: info.size.toString(),
    mtimeNs: info.mtimeNs.toString(),
    nlink: info.nlink.toString(),
    mode: info.mode.toString(),
  };
}
export function assertObservation(
  node: ArchiveNode,
  info: BigIntStats,
  directoryMayShrink = false,
): void {
  const actual = observation(info);
  if (
    JSON.stringify(node.native) !== JSON.stringify(actual.native) ||
    node.mode !== actual.mode ||
    ((node.kind !== 'directory' || !directoryMayShrink) &&
      (node.size !== actual.size || node.mtimeNs !== actual.mtimeNs || node.nlink !== actual.nlink))
  )
    fail('source_changed');
  if (
    node.kind === 'directory'
      ? !info.isDirectory()
      : node.kind === 'file'
        ? !info.isFile()
        : !info.isSymbolicLink()
  )
    fail('kind_changed');
}
/** Bounded descriptor reads, exact native observations before/after and path revalidation. */
export async function readBoundFile(
  path: string,
  expected: ArchiveNode,
  consume?: (chunk: Buffer) => Promise<void>,
): Promise<string> {
  await canonicalDirectory(dirname(path));
  const before = await lstat(path, { bigint: true });
  assertObservation(expected, before);
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(ARCHIVE_LIMITS.file))
    fail('unsupported_file');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!sameNativeObservation(before, await handle.stat({ bigint: true })))
      fail('file_handle_changed');
    const buffer = Buffer.alloc(1024 * 1024),
      hash = createHash('sha256');
    let count = 0;
    for (;;) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - count + 1),
        count,
      );
      if (!bytesRead) break;
      count += bytesRead;
      if (count > Number(before.size)) fail('file_grew');
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      if (consume) await consume(chunk);
    }
    if (
      count !== Number(before.size) ||
      !sameNativeObservation(before, await handle.stat({ bigint: true }))
    )
      fail('file_changed');
    await canonicalDirectory(dirname(path));
    assertObservation(expected, await lstat(path, { bigint: true }));
    const digest = hash.digest('hex');
    if (expected.digest && digest !== expected.digest) fail('file_digest');
    return digest;
  } finally {
    await handle.close();
  }
}
export async function snapshotArchiveSources(roots: ArchiveRoots): Promise<ArchiveManifest> {
  validateRoots(roots);
  roots = Object.freeze({ ...roots });
  const nodes: ArchiveNode[] = [];
  let bytes = 0n;
  async function walk(role: ArchiveNode['role'], relativePath: string): Promise<void> {
    const path = nodePath(roots, { role, relativePath });
    await canonicalDirectory(dirname(path), relativePath === '');
    let info: BigIntStats;
    try {
      info = await lstat(path, { bigint: true });
    } catch (error) {
      if (relativePath === '' && absent(error)) fail('snapshot_root_missing');
      throw error;
    }
    if (nodes.length >= ARCHIVE_LIMITS.nodes) fail('node_limit');
    const kind = info.isDirectory()
      ? 'directory'
      : info.isFile()
        ? 'file'
        : info.isSymbolicLink()
          ? 'symbolic-link'
          : fail('unsupported_node');
    const node: ArchiveNode = { role, relativePath, kind, ...observation(info) };
    nodes.push(node);
    if (kind === 'directory') {
      await canonicalDirectory(path);
      const children = (await readdir(path)).sort();
      for (const child of children)
        await walk(role, relativePath ? `${relativePath}/${child}` : child);
      if (JSON.stringify(children) !== JSON.stringify((await readdir(path)).sort()))
        fail('children_changed');
    } else if (kind === 'file') {
      if (info.nlink !== 1n || info.size > BigInt(ARCHIVE_LIMITS.file)) fail('unsupported_file');
      bytes += info.size;
      if (bytes > BigInt(ARCHIVE_LIMITS.bytes)) fail('byte_limit');
      node.digest = await readBoundFile(path, node);
    } else {
      if (info.nlink !== 1n) fail('hardlinked_link');
      node.linkTarget = await linkObservation(roots, path);
    }
    assertObservation(node, await lstat(path, { bigint: true }));
  }
  for (const role of ARCHIVE_ROLES) await walk(role, '');
  nodes.sort((a, b) => (nodeKey(a) < nodeKey(b) ? -1 : nodeKey(a) > nodeKey(b) ? 1 : 0));
  const manifest: ArchiveManifest = {
    version: 'managed-verification-archive-v1',
    roots,
    totalBytes: bytes.toString(),
    nodes,
  };
  validateManifest(manifest, roots);
  return JSON.parse(manifestText(manifest)) as ArchiveManifest;
}
/** No new nodes may appear. Missing original nodes alone are admissible during resume. */
export async function verifyRemainingSources(manifest: ArchiveManifest): Promise<Set<string>> {
  const remaining = new Set<string>();
  const byKey = new Map(manifest.nodes.map((n) => [nodeKey(n), n]));
  async function visit(node: ArchiveNode): Promise<void> {
    const path = nodePath(manifest.roots, node);
    await canonicalDirectory(dirname(path), node.relativePath === '');
    let info: BigIntStats;
    try {
      info = await lstat(path, { bigint: true });
    } catch (error) {
      if (absent(error)) return;
      throw error;
    }
    assertObservation(node, info, true);
    remaining.add(nodeKey(node));
    if (node.kind === 'directory') {
      await canonicalDirectory(path);
      const children = (await readdir(path)).sort();
      for (const child of children) {
        const relativePath = node.relativePath ? `${node.relativePath}/${child}` : child;
        const original = byKey.get(nodeKey({ role: node.role, relativePath }));
        if (!original) fail('unknown_child');
        await visit(original);
      }
      if (JSON.stringify(children) !== JSON.stringify((await readdir(path)).sort()))
        fail('children_changed');
      assertObservation(node, await lstat(path, { bigint: true }), true);
    } else if (node.kind === 'file') await readBoundFile(path, node);
    else if ((await linkObservation(manifest.roots, path)) !== node.linkTarget)
      fail('link_changed');
  }
  for (const role of ARCHIVE_ROLES) {
    const root = byKey.get(nodeKey({ role, relativePath: '' }));
    if (root) await visit(root);
    else {
      await canonicalDirectory(dirname(manifest.roots[role]), true);
      try {
        await lstat(manifest.roots[role], { bigint: true });
        fail('new_root');
      } catch (error) {
        if (!absent(error)) throw error;
      }
    }
  }
  return remaining;
}
