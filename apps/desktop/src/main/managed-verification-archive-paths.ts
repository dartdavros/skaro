import { lstat, realpath, readlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from 'node:path';
import { encodeNativeIdentity, type ExactNativeIdentity } from './managed-native-identity';
import { hasCacheControls } from './managed-cache-files';
import {
  ARCHIVE_ROLES,
  fail,
  validRelative,
  within,
  type ArchiveNode,
  type ArchiveRoots,
} from './managed-verification-archive-metadata';

export const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export type HostGate = () => void;
export function gateNow(gate: HostGate): void {
  if (typeof gate !== 'function') fail('gate_required');
  const result: unknown = gate();
  if (result && typeof (result as Promise<unknown>).then === 'function')
    fail('gate_must_be_synchronous');
}
/** Every ancestor must be a real directory with exact canonical spelling. Never traverses a link. */
export async function canonicalDirectory(path: string, allowMissing = false): Promise<void> {
  if (!isAbsolute(path) || normalize(path) !== path) fail('noncanonical_path');
  const volume = parse(path).root;
  let current = volume;
  for (const part of relative(volume, path).split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      const info = await lstat(current, { bigint: true });
      if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(current)) !== current)
        fail('redirected_directory');
    } catch (error) {
      if (allowMissing && absent(error)) return;
      throw error;
    }
  }
}
export function nodePath(
  roots: ArchiveRoots,
  node: Pick<ArchiveNode, 'role' | 'relativePath'>,
): string {
  if (!validRelative(node.relativePath)) fail('relative_path');
  const root = roots[node.role],
    path = node.relativePath === '' ? root : join(root, ...node.relativePath.split('/'));
  if (!within(root, path)) fail('outside_root');
  return path;
}
/** Private is a host-owned root scope, never permission inferred from arbitrary manifest paths. */
export function privateLink(roots: ArchiveRoots, path: string, raw: string): void {
  if (!raw || hasCacheControls(raw)) fail('link_target');
  const destination = resolve(dirname(path), raw);
  if (!ARCHIVE_ROLES.some((role) => within(roots[role], destination))) fail('non_private_link');
}
export async function linkObservation(roots: ArchiveRoots, path: string): Promise<string> {
  await canonicalDirectory(dirname(path));
  const raw = await readlink(path);
  privateLink(roots, path, raw);
  return raw;
}
export async function pinDirectory(path: string): Promise<ExactNativeIdentity> {
  await canonicalDirectory(path);
  return encodeNativeIdentity(await lstat(path, { bigint: true }));
}
export async function requirePinnedDirectory(
  path: string,
  expected: ExactNativeIdentity,
): Promise<void> {
  const observed = await pinDirectory(path);
  if (JSON.stringify(observed) !== JSON.stringify(expected)) fail('directory_replaced');
}
