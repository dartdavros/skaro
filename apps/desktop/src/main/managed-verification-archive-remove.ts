import { lstat, readdir, rmdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  ARCHIVE_ROLES,
  fail,
  nodeKey,
  type ArchiveNode,
  type ArchiveRole,
} from './managed-verification-archive-metadata';
import {
  canonicalDirectory,
  gateNow,
  linkObservation,
  nodePath,
} from './managed-verification-archive-paths';
import {
  assertObservation,
  readBoundFile,
  verifyRemainingSources,
} from './managed-verification-archive-snapshot';
import { requireDatabaseIdentity } from './managed-verification-archive-sqlite';
import {
  useVerifiedArchive,
  verifyArchiveStorage,
  type VerifiedArchive,
} from './managed-verification-archive-store';

/** No deletion API accepts metadata, a digest, an old install identity, or a deserialized token. */
export async function removeArchivedSources(
  capability: VerifiedArchive,
  options: {
    roles: readonly ArchiveRole[];
    effectGate: (role: ArchiveRole) => void;
  },
): Promise<readonly ArchiveRole[]> {
  const effectGate = options.effectGate;
  const roles = options.roles ? [...options.roles] : [];
  if (
    !roles.length ||
    new Set(roles).size !== roles.length ||
    roles.some((role) => !ARCHIVE_ROLES.includes(role))
  )
    fail('explicit_roles_required');
  if (typeof effectGate !== 'function') fail('effect_gate_required');
  return useVerifiedArchive(
    capability,
    async (state) => {
      // A capability surviving in memory is not proof the archived bytes still exist unchanged.
      await verifyArchiveStorage(state);
      const { manifest } = state;
      const remaining = await verifyRemainingSources(manifest);
      const nodes = new Map(manifest.nodes.map((node) => [nodeKey(node), node]));
      const children = new Map<string, ArchiveNode[]>();
      for (const node of manifest.nodes) {
        if (!node.relativePath) continue;
        const path = node.relativePath;
        const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        const key = nodeKey({ role: node.role, relativePath: parent });
        const list = children.get(key) ?? [];
        list.push(node);
        children.set(key, list);
      }
      function lineage(node: ArchiveNode): ArchiveNode[] {
        const parts = node.relativePath ? node.relativePath.split('/') : [];
        const result: ArchiveNode[] = [];
        for (let count = 0; count <= parts.length; count++) {
          const ancestor = nodes.get(
            nodeKey({ role: node.role, relativePath: parts.slice(0, count).join('/') }),
          );
          if (!ancestor) fail('missing_ancestor');
          result.push(ancestor);
        }
        return result;
      }
      async function requireCurrent(node: ArchiveNode): Promise<void> {
        for (const ancestor of lineage(node)) {
          const path = nodePath(manifest.roots, ancestor);
          await canonicalDirectory(dirname(path));
          assertObservation(ancestor, await lstat(path, { bigint: true }), true);
          if (ancestor.kind === 'directory') {
            await canonicalDirectory(path);
            const expected = (children.get(nodeKey(ancestor)) ?? [])
              .filter((child) => remaining.has(nodeKey(child)))
              .map((child) => child.relativePath.split('/').at(-1)!)
              .sort();
            if (JSON.stringify((await readdir(path)).sort()) !== JSON.stringify(expected))
              fail('remaining_children_changed');
          }
        }
      }
      async function remove(node: ArchiveNode): Promise<void> {
        if (!remaining.has(nodeKey(node))) return;
        await requireCurrent(node);
        const path = nodePath(manifest.roots, node);
        if (node.kind === 'directory') {
          for (const child of children.get(nodeKey(node)) ?? []) await remove(child);
          await requireCurrent(node); // Full remaining child set must now be empty.
          requireDatabaseIdentity(state);
          gateNow(() => effectGate(node.role));
          await rmdir(path);
        } else {
          if (node.kind === 'file') await readBoundFile(path, node);
          else if ((await linkObservation(manifest.roots, path)) !== node.linkTarget)
            fail('link_changed');
          await requireCurrent(node);
          requireDatabaseIdentity(state);
          gateNow(() => effectGate(node.role));
          await unlink(path); // A link leaf is unlinked, never traversed.
        }
        remaining.delete(nodeKey(node));
      }
      for (const role of roles) {
        const root = nodes.get(nodeKey({ role, relativePath: '' }));
        if (root) await remove(root);
      }
      // Missing roots are physically settled, not adopted as a new created installTarget.
      const finalRemaining = await verifyRemainingSources(manifest);
      if (roles.some((role) => finalRemaining.has(`${role}:`))) fail('not_settled');
      return Object.freeze([...roles]);
    },
    true,
  );
}
