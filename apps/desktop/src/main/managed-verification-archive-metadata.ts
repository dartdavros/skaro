import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from 'node:path';
import { validExactNativeIdentity, type ExactNativeIdentity } from './managed-native-identity';
import { hasCacheControls } from './managed-cache-files';

export const ARCHIVE_ROLES = ['artifact', 'scratch', 'stage'] as const;
export type ArchiveRole = (typeof ARCHIVE_ROLES)[number];
export type ArchiveRoots = Readonly<Record<ArchiveRole, string>>;
export const ARCHIVE_LIMITS = Object.freeze({
  bytes: 256 * 1024 ** 2,
  nodes: 20000,
  file: 32 * 1024 ** 2,
});
export interface ArchiveNode {
  role: ArchiveRole;
  relativePath: string;
  kind: 'directory' | 'file' | 'symbolic-link';
  native: ExactNativeIdentity;
  size: string;
  mtimeNs: string;
  nlink: string;
  mode: string;
  digest?: string;
  linkTarget?: string;
}
export interface ArchiveManifest {
  version: 'managed-verification-archive-v1';
  roots: ArchiveRoots;
  totalBytes: string;
  nodes: readonly ArchiveNode[];
}
export function fail(reason: string): never {
  throw new Error(`managed_archive_${reason}`);
}
export function exactKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}
export function decimal(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    /^(0|[1-9][0-9]{0,19})$/.test(value) &&
    BigInt(value) <= (1n << 64n) - 1n
  );
}
export const digestValid = (value: unknown): value is string =>
  typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
export function within(root: string, target: string): boolean {
  const child = relative(root, target);
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}
export function validateRoots(value: unknown): asserts value is ArchiveRoots {
  if (!value || typeof value !== 'object' || !exactKeys(value, ARCHIVE_ROLES)) fail('roots');
  const roots = value as Record<string, unknown>;
  for (const role of ARCHIVE_ROLES) {
    const path = roots[role];
    if (
      typeof path !== 'string' ||
      !isAbsolute(path) ||
      normalize(path) !== path ||
      path === parse(path).root ||
      hasCacheControls(path)
    )
      fail('root_path');
  }
  const paths = ARCHIVE_ROLES.map((role) => roots[role] as string);
  if (paths.some((a, i) => paths.some((b, j) => i !== j && within(a, b))))
    fail('overlapping_roots');
}
export function validRelative(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === '' ||
      value
        .split('/')
        .every(
          (part) =>
            part !== '' &&
            part !== '.' &&
            part !== '..' &&
            !/[\\:]/.test(part) &&
            !hasCacheControls(part) &&
            !/[. ]$/.test(part) &&
            !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        ))
  );
}
export function nodeKey(node: Pick<ArchiveNode, 'role' | 'relativePath'>): string {
  return `${node.role}:${node.relativePath}`;
}
/** Canonical ordering is part of the digest, not an authority token. */
export function manifestText(manifest: ArchiveManifest): string {
  return JSON.stringify({
    version: manifest.version,
    roots: Object.fromEntries(ARCHIVE_ROLES.map((role) => [role, manifest.roots[role]])),
    totalBytes: manifest.totalBytes,
    nodes: [...manifest.nodes]
      .sort((a, b) => (nodeKey(a) < nodeKey(b) ? -1 : nodeKey(a) > nodeKey(b) ? 1 : 0))
      .map((n) => ({
        role: n.role,
        relativePath: n.relativePath,
        kind: n.kind,
        native: {
          version: n.native.version,
          dev: n.native.dev,
          ino: n.native.ino,
          birthtimeNs: n.native.birthtimeNs,
        },
        size: n.size,
        mtimeNs: n.mtimeNs,
        nlink: n.nlink,
        mode: n.mode,
        ...(n.kind === 'file' ? { digest: n.digest } : {}),
        ...(n.kind === 'symbolic-link' ? { linkTarget: n.linkTarget } : {}),
      })),
  });
}
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export function validateManifest(
  value: unknown,
  expectedRoots: ArchiveRoots,
): asserts value is ArchiveManifest {
  validateRoots(expectedRoots);
  if (
    !value ||
    typeof value !== 'object' ||
    !exactKeys(value, ['version', 'roots', 'totalBytes', 'nodes'])
  )
    fail('manifest');
  const m = value as ArchiveManifest;
  validateRoots(m.roots);
  if (
    m.version !== 'managed-verification-archive-v1' ||
    !decimal(m.totalBytes) ||
    !Array.isArray(m.nodes) ||
    m.nodes.length > ARCHIVE_LIMITS.nodes ||
    ARCHIVE_ROLES.some((role) => m.roots[role] !== expectedRoots[role])
  )
    fail('manifest_scope');
  const seen = new Map<string, ArchiveNode>();
  const folded = new Set<string>();
  const identities = new Set<string>();
  let bytes = 0n;
  for (const node of m.nodes) {
    if (
      !node ||
      typeof node !== 'object' ||
      !ARCHIVE_ROLES.includes(node.role) ||
      !validRelative(node.relativePath) ||
      !['directory', 'file', 'symbolic-link'].includes(node.kind) ||
      !validExactNativeIdentity(node.native) ||
      ![node.size, node.mtimeNs, node.nlink, node.mode].every(decimal) ||
      BigInt(node.nlink) < 1n ||
      BigInt(node.mode) > 0o177777n
    )
      fail('node');
    const keys = ['role', 'relativePath', 'kind', 'native', 'size', 'mtimeNs', 'nlink', 'mode'];
    if (node.kind === 'file') {
      keys.push('digest');
      if (
        !digestValid(node.digest) ||
        node.nlink !== '1' ||
        BigInt(node.size) > BigInt(ARCHIVE_LIMITS.file)
      )
        fail('file');
      bytes += BigInt(node.size);
    } else if (node.kind === 'symbolic-link') {
      keys.push('linkTarget');
      if (
        node.relativePath === '' ||
        typeof node.linkTarget !== 'string' ||
        !node.linkTarget ||
        hasCacheControls(node.linkTarget) ||
        node.nlink !== '1'
      )
        fail('link');
      const path = join(m.roots[node.role as ArchiveRole], ...node.relativePath.split('/'));
      const destination = resolve(dirname(path), node.linkTarget);
      if (!ARCHIVE_ROLES.some((role) => within(m.roots[role], destination)))
        fail('non_private_link');
    }
    const kindMode = BigInt(node.mode) & 0o170000n;
    if (
      kindMode !==
      (node.kind === 'directory' ? 0o040000n : node.kind === 'file' ? 0o100000n : 0o120000n)
    )
      fail('node_mode');
    if (!exactKeys(node, keys)) fail('node_fields');
    const key = nodeKey(node),
      foldedKey = key.toLowerCase();
    if (seen.has(key) || folded.has(foldedKey)) fail('duplicate_path');
    const identityKey = `${node.native.dev}:${node.native.ino}:${node.native.birthtimeNs}`;
    if (identities.has(identityKey)) fail('duplicate_native_identity');
    identities.add(identityKey);
    seen.set(key, node);
    folded.add(foldedKey);
  }
  if (bytes !== BigInt(m.totalBytes) || bytes > BigInt(ARCHIVE_LIMITS.bytes)) fail('byte_limit');
  if (ARCHIVE_ROLES.some((role) => !seen.has(nodeKey({ role, relativePath: '' }))))
    fail('missing_original_root');
  for (const node of m.nodes) {
    if (node.relativePath === '') {
      if (node.kind !== 'directory') fail('root_directory');
    } else {
      const parent = node.relativePath.includes('/')
        ? node.relativePath.slice(0, node.relativePath.lastIndexOf('/'))
        : '';
      if (seen.get(nodeKey({ role: node.role, relativePath: parent }))?.kind !== 'directory')
        fail('missing_parent');
    }
  }
}
/** Logical counts only. Host must add filesystem allocation rounding/metadata before reserving disk. */
export function archiveMetadataSummary(manifest: ArchiveManifest) {
  validateManifest(manifest, manifest.roots);
  const files = manifest.nodes.filter((node) => node.kind === 'file');
  const unique = new Map(files.map((node) => [node.digest!, node.size]));
  const blobBytes = [...unique.values()].reduce((sum, size) => sum + BigInt(size), 0n);
  const manifestBytes = Buffer.byteLength(manifestText(manifest));
  return Object.freeze({
    totalBytes: manifest.totalBytes,
    blobBytes: blobBytes.toString(),
    reservationBytes: (blobBytes + BigInt(manifestBytes)).toString(),
    manifestBytes,
    nodeCount: manifest.nodes.length,
    fileCount: files.length,
    blobCount: unique.size,
  });
}
export function parseManifest(text: string, expectedRoots: ArchiveRoots): ArchiveManifest {
  const value: unknown = JSON.parse(text);
  validateManifest(value, expectedRoots);
  if (manifestText(value) !== text) fail('noncanonical_manifest');
  return value;
}
