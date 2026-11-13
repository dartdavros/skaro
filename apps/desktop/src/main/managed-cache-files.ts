import { createHash } from 'node:crypto';
import { constants, type Stats, type BigIntStats } from 'node:fs';
import { sameNativeIdentity, sameNativeObservation } from './managed-native-identity';
import { copyFile, lstat, mkdir, open, readdir, realpath, rmdir, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from 'node:path';
import { CacheRemovalPlan } from './managed-cache-removal-plan';

export const hasCacheControls = (value: string) =>
  [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
export const CACHE_FILE_LIMIT = 50000;
export const CACHE_BYTE_LIMIT = 8 * 1024 ** 3;
const same = (a: string, b: string) =>
  process.platform === 'win32'
    ? normalize(a).toLowerCase() === normalize(b).toLowerCase()
    : normalize(a) === normalize(b);
const unchanged = (a: BigIntStats, b: BigIntStats) =>
  sameNativeObservation(a, b) && b.isFile() && b.nlink === 1n;

/** Check EVERY ancestor. Junctions inside and above an owned root are never followed. */
/** A changing source can never grow an unbounded read allocation after the initial stat. */
export async function readCacheFile(root: string, target: string, limit: number) {
  await canonicalCachePath(root, target);
  const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat({ bigint: true });
    if (!info.isFile() || info.nlink !== 1n || info.size < 0n || info.size > BigInt(limit))
      throw new Error('managed_cache_source_file_unsupported');
    const data = Buffer.alloc(Number(info.size) + 1);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await file.read(data, offset, data.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (BigInt(offset) !== info.size || !unchanged(info, await file.stat({ bigint: true })))
      throw new Error('managed_cache_source_file_changed');
    return { data: data.subarray(0, offset), mode: Number(info.mode & 0o777n) };
  } finally {
    await file.close();
  }
}
export async function canonicalCachePath(
  root: string,
  target: string,
  missing = false,
): Promise<string> {
  root = resolve(root);
  target = resolve(target);
  const child = relative(root, target);
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child))
    throw new Error('managed_cache_path_outside_scope');
  const volume = parse(target).root;
  let current = volume;
  for (const part of relative(volume, target).split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !same(await realpath(current), current))
        throw new Error('managed_cache_path_redirected');
    } catch (error) {
      if (missing && (error as NodeJS.ErrnoException).code === 'ENOENT') return target;
      throw error;
    }
  }
  return target;
}
export async function cacheDirectory(root: string, target: string): Promise<string> {
  target = await canonicalCachePath(root, target, true);
  if (same(root, target)) await mkdir(target, { recursive: true });
  else {
    await cacheDirectory(root, dirname(target));
    await mkdir(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
  await canonicalCachePath(root, target);
  if (!(await lstat(target)).isDirectory()) throw new Error('managed_cache_directory_required');
  return target;
}
export interface CacheFile {
  path: string;
  bytes: number;
  digest: string;
}
export async function cacheTree(root: string, target: string, ceiling = CACHE_BYTE_LIMIT) {
  const files: CacheFile[] = [],
    nodes = new Map<string, { info: Stats; native: BigIntStats; children?: string[] }>();
  let bytes = 0;
  async function walk(path: string): Promise<void> {
    await canonicalCachePath(root, path);
    const native = await lstat(path, { bigint: true });
    const info = await lstat(path);
    if (!sameNativeObservation(native, await lstat(path, { bigint: true })))
      throw new Error('managed_cache_file_changed');
    if (nodes.size >= CACHE_FILE_LIMIT) throw new Error('managed_cache_file_limit');
    if (info.isDirectory()) {
      const children = (await readdir(path)).sort();
      nodes.set(path, { info, native, children });
      for (const entry of children) await walk(join(path, entry));
      if (!sameNativeIdentity(native, await lstat(path, { bigint: true })))
        throw new Error('managed_cache_directory_changed');
    } else if (info.isFile() && info.nlink === 1) {
      bytes += info.size;
      if (bytes > Math.min(ceiling, CACHE_BYTE_LIMIT)) throw new Error('managed_cache_byte_limit');
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const hash = createHash('sha256');
      try {
        if (!unchanged(native, await file.stat({ bigint: true })))
          throw new Error('managed_cache_file_changed');
        for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
        if (!unchanged(native, await file.stat({ bigint: true })))
          throw new Error('managed_cache_file_changed');
      } finally {
        await file.close();
      }
      nodes.set(path, { info, native });
      files.push({
        path: relative(target, path).split(sep).join('/'),
        bytes: info.size,
        digest: hash.digest('hex'),
      });
    } else throw new Error('managed_cache_non_regular_file');
  }
  await walk(target);
  return {
    bytes,
    files,
    nodes,
    digest: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
  };
}
/** Bounded deletion of a captured native set. A supplied observation is NEVER re-baselined. */
export async function removeCacheTree(
  root: string,
  target: string,
  expectedDigest?: string,
  /** Synchronous live-authority gate immediately before EVERY destructive syscall. */
  onEffect?: () => void,
  expectedObservation?: Awaited<ReturnType<typeof cacheTree>>,
): Promise<number> {
  root = resolve(root);
  target = resolve(target);
  if (same(root, target)) throw new Error('managed_cache_root_deletion_forbidden');
  const observed = expectedObservation ?? (await cacheTree(root, target));
  if (expectedDigest && observed.digest !== expectedDigest)
    throw new Error('managed_cache_integrity_changed');
  // Snapshot before any await/callback can mutate the caller's observation.
  const plan = new CacheRemovalPlan(target, observed),
    bytes = observed.bytes;
  async function requireCurrent(path: string) {
    for (const ancestor of plan.lineage(path)) {
      await canonicalCachePath(root, ancestor);
      const info = await lstat(ancestor, { bigint: true });
      plan.assertNative(ancestor, info);
      if (info.isDirectory()) plan.assertChildren(ancestor, (await readdir(ancestor)).sort());
    }
  }
  async function verifyFile(path: string) {
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await file.stat({ bigint: true });
      plan.assertNative(path, info);
      const hash = createHash('sha256');
      let read = 0;
      for await (const chunk of file.createReadStream({
        autoClose: false,
        end: Number(info.size),
      })) {
        read += chunk.length;
        if (BigInt(read) > info.size) throw new Error('managed_cache_file_changed');
        hash.update(chunk);
      }
      plan.assertNative(path, await file.stat({ bigint: true }));
      if (BigInt(read) !== info.size || hash.digest('hex') !== plan.digest(path))
        throw new Error('managed_cache_integrity_changed');
    } finally {
      await file.close();
    }
  }
  async function remove(path: string): Promise<void> {
    await requireCurrent(path);
    const children = plan.children(path);
    if (children) {
      for (const entry of children) await remove(join(path, entry));
      await requireCurrent(path); // Original inode + exactly the expected (now empty) child set.
      onEffect?.();
      await rmdir(path);
    } else {
      await verifyFile(path);
      await requireCurrent(path);
      onEffect?.();
      await unlink(path);
    }
    plan.removed(path);
  }
  await remove(target);
  return bytes;
}
export async function cloneCacheTree(
  root: string,
  source: string,
  target: string,
  digest: string,
  created?: () => void,
) {
  const tree = await cacheTree(root, source);
  if (tree.digest !== digest) throw new Error('managed_cache_integrity_changed');
  await canonicalCachePath(root, target, true);
  try {
    await lstat(target);
    throw new Error('managed_cache_scratch_already_exists');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await cacheDirectory(root, dirname(target));
  await mkdir(target, { mode: 0o700 });
  created?.();
  for (const file of tree.files) {
    const input = join(source, file.path),
      destination = join(target, file.path),
      node = tree.nodes.get(input)!;
    await cacheDirectory(root, dirname(destination));
    await canonicalCachePath(root, input);
    await canonicalCachePath(root, destination, true);
    if (!unchanged(node.native, await lstat(input, { bigint: true })))
      throw new Error('managed_cache_file_changed');
    await copyFile(input, destination, constants.COPYFILE_EXCL);
  }
  if ((await cacheTree(root, target)).digest !== digest)
    throw new Error('managed_cache_clone_integrity_changed');
  return tree.bytes;
}
