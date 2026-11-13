import { expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { encodeNativeIdentity } from './managed-native-identity';
import {
  ARCHIVE_LIMITS,
  archiveMetadataSummary,
  manifestText,
  parseManifest,
  sha256,
  validateManifest,
  validRelative,
  type ArchiveManifest,
  type ArchiveNode,
  type ArchiveRoots,
} from './managed-verification-archive-metadata';
import { gateNow, privateLink } from './managed-verification-archive-paths';
import { archiveReceipt, type VerifiedArchive } from './managed-verification-archive-store';
import { removeArchivedSources } from './managed-verification-archive-remove';

// Pure metadata only: these paths are never read, created, or treated as actual project trees.
const roots: ArchiveRoots = {
  artifact: resolve('owner-evidence-scope', 'artifact'),
  scratch: resolve('owner-evidence-scope', 'scratch'),
  stage: resolve('owner-evidence-scope', 'stage'),
};
const native = (offset = 0n) =>
  encodeNativeIdentity({
    dev: 37n,
    ino: 13229323907920232n + offset,
    birthtimeNs: 1794519347717123456n,
  });
function node(relativePath: string, kind: ArchiveNode['kind'], offset: bigint): ArchiveNode {
  return {
    role: 'artifact',
    relativePath,
    kind,
    native: native(offset),
    size: '0',
    mtimeNs: '1794519347717123456',
    nlink: '1',
    mode: kind === 'directory' ? '16832' : kind === 'file' ? '33152' : '41471',
    ...(kind === 'file' ? { digest: sha256('') } : {}),
    ...(kind === 'symbolic-link' ? { linkTarget: 'bytes' } : {}),
  };
}
function metadata(): ArchiveManifest {
  return {
    version: 'managed-verification-archive-v1',
    roots: { ...roots },
    totalBytes: '0',
    nodes: [
      node('', 'directory', 0n),
      node('bytes', 'file', 1n),
      node('leaf', 'symbolic-link', 2n),
      { ...node('', 'directory', 3n), role: 'scratch' },
      { ...node('', 'directory', 4n), role: 'stage' },
    ],
  };
}
it('preserves exact adjacent native IDs, nanoseconds, raw link leaves and canonical digest across JSON', () => {
  const input = metadata(),
    text = manifestText(input),
    decoded = parseManifest(text, roots);
  expect(decoded.nodes.slice(0, 3).map((entry) => entry.native.ino)).toEqual([
    '13229323907920232',
    '13229323907920233',
    '13229323907920234',
  ]);
  expect(Number(decoded.nodes[0]!.native.ino)).toBe(Number(decoded.nodes[1]!.native.ino));
  expect(decoded.nodes[2]!.linkTarget).toBe('bytes');
  expect(sha256(manifestText(decoded))).toBe(sha256(text));
  expect(() => parseManifest(`${text}\n`, roots)).toThrow('noncanonical_manifest');
  expect(() =>
    parseManifest(text, { ...roots, artifact: join(roots.artifact, 'replacement') }),
  ).toThrow('manifest_scope');
});
it('rejects unknown executable-looking metadata, rounded identities and noncanonical decimal observations', () => {
  const input = metadata();
  expect(() => validateManifest({ ...input, effectGate: 'run' }, roots)).toThrow('manifest');
  for (const field of ['size', 'mtimeNs', 'nlink', 'mode'] as const) {
    for (const value of ['01', '-1', '1e2', '1.0', 1, 1n]) {
      const changed = metadata();
      (changed.nodes[1] as unknown as Record<string, unknown>)[field] = value;
      expect(() => validateManifest(changed, roots)).toThrow();
    }
  }
  const changed = metadata();
  (changed.nodes[1]!.native as unknown as Record<string, unknown>).ino = Number(
    changed.nodes[1]!.native.ino,
  );
  expect(() => validateManifest(changed, roots)).toThrow('node');
});
it('requires exact byte accounting and rejects hard links and oversize files before archive effects', () => {
  for (const edit of [
    (n: ArchiveNode) => {
      n.nlink = '2';
    },
    (n: ArchiveNode) => {
      n.size = String(ARCHIVE_LIMITS.file + 1);
    },
    (n: ArchiveNode) => {
      n.size = '1';
    },
    (n: ArchiveNode) => {
      n.digest = 'a'.repeat(63);
    },
  ]) {
    const input = metadata();
    edit(input.nodes[1]!);
    expect(() => validateManifest(input, roots)).toThrow();
  }
  const input = metadata();
  input.totalBytes = '1';
  expect(() => validateManifest(input, roots)).toThrow('byte_limit');
});
it('enforces the 256MiB sum in exact decimal arithmetic, counting duplicate contents too', () => {
  const input = metadata();
  input.nodes = [
    node('', 'directory', 0n),
    ...Array.from({ length: 9 }, (_, index) => ({
      ...node(`file-${index}`, 'file', BigInt(index + 10)),
      size: String(ARCHIVE_LIMITS.file),
    })),
    ...metadata().nodes.slice(3),
  ];
  input.totalBytes = String(ARCHIVE_LIMITS.file * 9);
  expect(() => validateManifest(input, roots)).toThrow('byte_limit');
  input.nodes = input.nodes.filter((entry) => entry.relativePath !== 'file-8');
  input.totalBytes = String(ARCHIVE_LIMITS.bytes);
  expect(() => validateManifest(input, roots)).not.toThrow();
});
it('rejects alias paths, orphan nodes, link-parent traversal, root links and duplicated native identities', () => {
  for (const path of [
    '../outside',
    'a/../b',
    '/absolute',
    'a\\b',
    'x:stream',
    'a//b',
    'a.',
    'a ',
    'NUL',
    'a/COM1.log',
  ])
    expect(validRelative(path)).toBe(false);
  expect(validRelative('package/@scope/name')).toBe(true);
  const orphan = metadata();
  orphan.nodes[1]!.relativePath = 'missing/bytes';
  expect(() => validateManifest(orphan, roots)).toThrow('missing_parent');
  const alias = metadata();
  alias.nodes = [...alias.nodes, node('BYTES', 'file', 3n)];
  expect(() => validateManifest(alias, roots)).toThrow('duplicate_path');
  const duplicate = metadata();
  duplicate.nodes[1]!.native = duplicate.nodes[0]!.native;
  expect(() => validateManifest(duplicate, roots)).toThrow('duplicate_native_identity');
  const rootLink = metadata();
  rootLink.nodes = [node('', 'symbolic-link', 0n)];
  expect(() => validateManifest(rootLink, roots)).toThrow('link');
});
it('allows only private lexical link destinations and never treats link-target text as instructions', () => {
  expect(() => privateLink(roots, join(roots.artifact, 'leaf'), 'bytes')).not.toThrow();
  expect(() => privateLink(roots, join(roots.artifact, 'leaf'), roots.stage)).not.toThrow();
  expect(() => privateLink(roots, join(roots.artifact, 'leaf'), '../../outside')).toThrow(
    'non_private_link',
  );
  const input = metadata();
  input.nodes[2]!.linkTarget = '../../outside';
  expect(() => validateManifest(input, roots)).toThrow('non_private_link');
});
it('never upgrades serialized archive metadata or a receipt into an in-memory deletion capability', () => {
  const serialized = JSON.parse(manifestText(metadata()));
  expect(() => archiveReceipt(serialized as VerifiedArchive)).toThrow(
    'verified_capability_required',
  );
  expect(() =>
    archiveReceipt({
      manifestDigest: sha256(manifestText(metadata())),
    } as unknown as VerifiedArchive),
  ).toThrow('verified_capability_required');
});
it('requires initial original roots and exposes logical counts without claiming an allocation reservation', () => {
  const input = metadata();
  expect(archiveMetadataSummary(input)).toMatchObject({
    totalBytes: '0',
    blobBytes: '0',
    nodeCount: 5,
    fileCount: 1,
    blobCount: 1,
  });
  const summary = archiveMetadataSummary(input);
  expect(summary.reservationBytes).toBe(String(summary.manifestBytes));
  input.nodes = input.nodes.filter((entry) => entry.role !== 'stage');
  expect(() => validateManifest(input, roots)).toThrow('missing_original_root');
});
it('never defaults deletion to all roles or accepts a repeated role subset', async () => {
  // Invalid API metadata is rejected before any filesystem operation or callback.
  for (const roles of [[], ['artifact', 'artifact'], ['unknown']] as const) {
    await expect(
      removeArchivedSources({} as VerifiedArchive, {
        roles: roles as unknown as ('artifact' | 'scratch' | 'stage')[],
        effectGate: () => {
          throw new Error('must_not_reach_effect');
        },
      }),
    ).rejects.toThrow('explicit_roles_required');
  }
});
it('requires a synchronous fresh gate and propagates refusal without swallowing it', () => {
  expect(() =>
    gateNow(() => {
      throw new Error('owner_fence_expired');
    }),
  ).toThrow('owner_fence_expired');
  expect(() => gateNow((() => Promise.resolve()) as () => void)).toThrow(
    'gate_must_be_synchronous',
  );
});
