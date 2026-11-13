import { lstat, readdir } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { cacheTree, canonicalCachePath } from '../managed-cache-files';
import { npmArchivePath } from '../managed-npm-archive';
import { reconciliationHash } from './cache-verification-reconciliation-layout';
import { uniqueReconciliationEntry } from './cache-verification-reconciliation-unique';
import { assertUniqueReconciliationInputs } from './cache-verification-reconciliation-unique-inputs';
import {
  replayFail as fail,
  replayHash,
  replayInteger,
  replayKeys,
  RECONCILIATION_JOURNAL_NODE_LIMIT,
  type CacheReconciliationJournal,
  type ReconciliationRole,
  type ReconciliationTree,
} from './cache-verification-reconciliation-replay-types';

export function assertReplayTree(tree: ReconciliationTree, expectedPath: string) {
  replayKeys(tree, ['path', 'bytes', 'files', 'directories', 'digest', 'identities']);
  if (tree.path !== expectedPath) fail('tree_scope');
  replayInteger(tree.bytes);
  if (tree.bytes > 32 * 1024 ** 2) fail('tree_bytes');
  replayHash(tree.digest);
  if (
    !Array.isArray(tree.files) ||
    !Array.isArray(tree.directories) ||
    !Array.isArray(tree.identities) ||
    tree.files.length + tree.directories.length > RECONCILIATION_JOURNAL_NODE_LIMIT ||
    tree.identities.length !== tree.files.length + tree.directories.length
  )
    fail('tree_nodes');
  const names = new Map<string, { path: string; directory: boolean }>();
  function name(path: unknown, directory: boolean) {
    if (typeof path !== 'string') return fail('tree_path');
    if (path.length > 512 || (!path && !directory)) fail('tree_path');
    if (path) npmArchivePath(`package/${path}`, directory ? 53 : 48);
    if (names.has(path.toLowerCase())) fail('tree_alias');
    names.set(path.toLowerCase(), { path, directory });
  }
  for (const directory of tree.directories) name(directory, true);
  for (const file of tree.files) {
    replayKeys(file, ['path', 'bytes', 'digest']);
    name(file.path, false);
    replayInteger(file.bytes);
    replayHash(file.digest);
  }
  if (!names.get('')?.directory) fail('tree_root_required');
  const identities = new Set<string>();
  for (const identity of tree.identities) {
    replayKeys(identity, [
      'path',
      'directory',
      'dev',
      'ino',
      'birthtimeMs',
      'mtimeMs',
      'bytes',
      'nlink',
    ]);
    if (
      identities.has(identity.path) ||
      !isDeepStrictEqual(names.get(identity.path.toLowerCase()), {
        path: identity.path,
        directory: identity.directory,
      })
    )
      fail('tree_identity');
    identities.add(identity.path);
    // Preserve the plan's native Stats-number identity contract: Windows inode numbers can exceed
    // MAX_SAFE_INTEGER. They are compared unchanged with dev/birthtime, never used as counters.
    for (const value of [identity.dev, identity.ino])
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        !Number.isInteger(value) ||
        value < 0
      )
        fail('tree_native_id');
    for (const value of [identity.bytes, identity.nlink]) replayInteger(value);
    for (const value of [identity.birthtimeMs, identity.mtimeMs])
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail('tree_time');
    if (!identity.directory && identity.nlink !== 1) fail('tree_private_file');
    const file = tree.files.find((file) => file.path === identity.path);
    if (file && file.bytes !== identity.bytes) fail('tree_file_size');
  }
  for (const { path } of names.values()) {
    const parts = path.split('/');
    for (let length = 1; length < parts.length; length++) {
      const parent = parts.slice(0, length).join('/');
      if (!isDeepStrictEqual(names.get(parent.toLowerCase()), { path: parent, directory: true }))
        fail('tree_parent_missing');
    }
  }
  if (
    tree.bytes !== tree.files.reduce((sum, file) => sum + file.bytes, 0) ||
    tree.digest !== reconciliationHash(JSON.stringify(tree.files))
  )
    fail('tree_digest');
}

/** A surviving tree may ONLY lose original nodes; every present inode/file is checked, including root. */
export async function reconciliationRemainder(
  journal: CacheReconciliationJournal,
  role: ReconciliationRole,
): Promise<Awaited<ReturnType<typeof cacheTree>> | undefined> {
  const expected = journal.trees[role];
  await canonicalCachePath(journal.storeRoot, expected.path, true);
  try {
    await lstat(expected.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const tree = await cacheTree(journal.storeRoot, expected.path, expected.bytes),
    files = new Map(expected.files.map((file) => [file.path, file])),
    nodes = new Map(expected.identities.map((node) => [node.path, node]));
  if (tree.nodes.size > expected.identities.length) fail('unexpected_remaining_nodes');
  for (const file of tree.files)
    if (!isDeepStrictEqual(files.get(file.path), file)) fail('remaining_file_changed');
  for (const [path, node] of tree.nodes) {
    await canonicalCachePath(journal.storeRoot, path);
    const name = relative(expected.path, path).split(sep).join('/'),
      original = nodes.get(name),
      info = await lstat(path),
      before = node.info;
    if (
      !original ||
      info.dev !== original.dev ||
      info.ino !== original.ino ||
      info.birthtimeMs !== original.birthtimeMs ||
      info.isDirectory() !== original.directory ||
      (!info.isDirectory() &&
        (!info.isFile() ||
          info.nlink !== 1 ||
          info.size !== original.bytes ||
          info.mtimeMs !== original.mtimeMs)) ||
      info.dev !== before.dev ||
      info.ino !== before.ino ||
      info.birthtimeMs !== before.birthtimeMs ||
      info.mtimeMs !== before.mtimeMs ||
      info.size !== before.size ||
      info.nlink !== before.nlink ||
      (node.children && !isDeepStrictEqual((await readdir(path)).sort(), node.children))
    )
      fail('remaining_physical_identity_changed');
  }
  return tree;
}

export function assertReplayOriginalInputs(journal: CacheReconciliationJournal, version: string) {
  const stage = journal.trees.stage;
  if (
    !isDeepStrictEqual(stage.directories, ['']) ||
    !isDeepStrictEqual(
      stage.files.map((file) => file.path),
      ['package.json', 'pnpm-lock.yaml'],
    ) ||
    reconciliationHash(JSON.stringify(stage.files.map((file) => file.digest))) !== version
  )
    fail('original_input_pair_digest');
  const scratch = journal.trees.scratch;
  if (uniqueReconciliationEntry(journal.original.entry)) {
    assertUniqueReconciliationInputs(journal.original.entry, stage, scratch);
    if (journal.trees.artifact.bytes !== journal.original.entry.bytes)
      fail('unique_artifact_bytes');
    return;
  }
  if (
    !isDeepStrictEqual(scratch.directories, ['', 'home']) ||
    !isDeepStrictEqual(
      scratch.files.map((file) => [file.path, file.bytes, file.digest]),
      [
        ['home/global.npmrc', 0, reconciliationHash('')],
        ['home/user.npmrc', 0, reconciliationHash('')],
      ],
    )
  )
    fail('original_scratch_phase');
  // The positive initial plan proves completed downloads plus at most one valid in-flight tarball.
  // Its immutable physical inventory is authoritative; the failed producer's accounting may lag.
  if (journal.trees.artifact.bytes < journal.original.entry.bytes) fail('original_artifact_bytes');
}
