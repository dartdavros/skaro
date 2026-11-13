import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { cacheTree, canonicalCachePath } from '../managed-cache-files';
import { readManagedPnpmInput } from '../managed-pnpm-provenance';
import { readReconciliationArchives } from './cache-verification-reconciliation-archives';
import type { ManagedArtifact, ManagedCacheStore } from '../managed-cache-store';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import { cacheProcessAbsent } from '../managed-cache-metadata';
import type { ResourceRecord } from '@skaro/core';
import { CACHE_VERIFICATION_OWNER_SCOPE } from './cache-verification-scope';
import {
  readReconciliationAccounting,
  type ReconciliationAccounting,
} from './cache-verification-reconciliation-accounting';

export const CACHE_RECONCILIATION_ATTEMPT = Object.freeze({
  intentId: '5c22df0b-7bbb-42e0-b173-5de72efad0ac',
  key: '82482632e50f0f8f43a01b9bc412d538a89fbbfd8f8f0f0c5a9d9d81284bc6a5',
  artifactId: 'resource-46890620bdf06022323dcc51659e45560898cf1c155ddb79cceed756121976ad',
  stageId: 'resource-5df2f8ae9bc1b4062104eec64c0b47b3eaa4c0bffdc4391f341f33cf3daddbef',
  sourceId: 'resource-208b5911e00587ace82dd4cc5ef47302ad033278b3d4087a94e19ba02e2d777a',
  sourceLeaseId: 'c3808eaa-498b-49ed-8ffb-effed791dad1',
  dependenciesLeaseId: 'd6635421-c166-4095-851b-e27d9a8d46cf',
  inputDirectory: '9083ab63-1582-4472-91e5-f20601f77c34',
  inputVersion: '4d379e0ac41bbf065870259f7f3ddabbcf581ea7e2306dbf42e171bff14044a3',
  pid: 19292,
  birth: '639300913070921371',
});
/** Additional native absence only; never a replacement for domain/phase evidence. */
export async function requireNativeAbsence(
  receipt: { pid: number } = CACHE_RECONCILIATION_ATTEMPT,
) {
  const { pid } = receipt;
  if (!cacheProcessAbsent(pid) || (await processBirth(pid)) !== undefined)
    fail('old_native_owner_not_absent');
}

const fail = (reason: string): never => {
  throw new Error(`cache_reconciliation_${reason}`);
};
export const reconciliationHash = (value: Buffer | string) =>
  createHash('sha256').update(value).digest('hex');
export const pnpmInputVersion = (input: { packageBytes: Buffer; lockBytes: Buffer }) =>
  reconciliationHash(
    JSON.stringify([reconciliationHash(input.packageBytes), reconciliationHash(input.lockBytes)]),
  );
export type ReadonlyReconciliation<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: ReadonlyReconciliation<T[K]> }
    : T;
export function freezeReconciliation<T>(value: T): ReadonlyReconciliation<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeReconciliation(child);
    Object.freeze(value);
  }
  return value as ReadonlyReconciliation<T>;
}

/** Pure shape check: binding/classification may never be inferred from a pathname alone. */
export function assertReconciliationResourceBinding(
  resource: ResourceRecord,
  path: string,
  source: ResourceRecord['source'],
  root = false,
) {
  const metadata = ['id', 'revision', 'createdAt', 'updatedAt', 'consumers', 'lastOutcome'];
  if (
    !isDeepStrictEqual(
      Object.fromEntries(Object.entries(resource).filter(([key]) => !metadata.includes(key))),
      {
        projectId: CACHE_VERIFICATION_OWNER_SCOPE.projectId,
        kind: root ? 'worktree' : 'cache',
        identity: { path },
        owner: { kind: 'project', id: CACHE_VERIFICATION_OWNER_SCOPE.projectId },
        purpose: root ? 'project-dev' : 'cache',
        ownership: 'registered',
        preservation: root ? 'persistent' : 'reproducible',
        generation: resource.generation,
        state: 'available',
        source,
      },
    )
  )
    fail('resource_binding_changed');
}

/** Includes empty directories and physical identities; cacheTree.digest alone describes only files. */
export async function reconciliationInventory(root: string, path: string) {
  const tree = await cacheTree(root, path);
  const directories: string[] = [],
    identities = [];
  const aliases = new Set<string>();
  for (const [target, node] of tree.nodes) {
    await canonicalCachePath(root, target);
    const info = await lstat(target),
      before = node.info;
    const name = relative(path, target).split(sep).join('/');
    if (aliases.has(name.toLowerCase())) fail('physical_alias');
    aliases.add(name.toLowerCase());
    if (
      info.dev !== before.dev ||
      info.ino !== before.ino ||
      info.birthtimeMs !== before.birthtimeMs ||
      info.mtimeMs !== before.mtimeMs ||
      info.size !== before.size ||
      info.isDirectory() !== before.isDirectory() ||
      (!info.isDirectory() && (!info.isFile() || info.nlink !== 1)) ||
      (node.children && !isDeepStrictEqual((await readdir(target)).sort(), node.children))
    )
      fail('physical_tree_changed');
    if (info.isDirectory()) directories.push(name);
    identities.push({
      path: name,
      directory: info.isDirectory(),
      dev: info.dev,
      ino: info.ino,
      birthtimeMs: info.birthtimeMs,
      mtimeMs: info.mtimeMs,
      bytes: info.size,
      nlink: info.nlink,
    });
  }
  directories.sort();
  return {
    path,
    bytes: tree.bytes,
    files: tree.files,
    directories,
    digest: tree.digest,
    identities,
  };
}

/** No extraction, execution, network, directory creation or cleanup. Unknown phase shapes fail closed. */
export async function readReconciliationLayout(
  store: ManagedCacheStore,
  entry: ManagedArtifact,
  stagePath: string,
  expectedInputVersion: string,
  sourceInputPath: string,
  failure: ReconciliationAccounting['pending']['failure'],
) {
  if (entry.expansionPolicy !== undefined || entry.installTarget !== undefined)
    fail('legacy_publication_required');
  const input = await readManagedPnpmInput(stagePath);
  if (pnpmInputVersion(input) !== expectedInputVersion) fail('original_stage_digest_changed');
  const sourceInput = await readManagedPnpmInput(sourceInputPath);
  if (
    !input.packageBytes.equals(sourceInput.packageBytes) ||
    !input.lockBytes.equals(sourceInput.lockBytes)
  )
    fail('current_source_input_changed');
  const path = store.path(entry.key);
  const scratchPath = join(store.root, 'scratch', `${entry.key}-publish`);
  const stage = await reconciliationInventory(store.root, stagePath);
  if (
    !isDeepStrictEqual(stage.directories, ['']) ||
    !isDeepStrictEqual(
      stage.files.map((file) => file.path),
      ['package.json', 'pnpm-lock.yaml'],
    )
  )
    fail('stage_layout_unknown');
  const artifact = await reconciliationInventory(store.root, path);
  const scratch = await reconciliationInventory(store.root, scratchPath);
  if (
    !isDeepStrictEqual(scratch.directories, ['', 'home']) ||
    !isDeepStrictEqual(
      scratch.files.map((file) => [file.path, file.bytes]),
      [
        ['home/global.npmrc', 0],
        ['home/user.npmrc', 0],
      ],
    ) ||
    scratch.files.some((file) => file.digest !== reconciliationHash(''))
  )
    fail('scratch_phase_unknown');
  // A full official archive/runtime and positive journaled bytes prove exclusive roots were created.
  // No manifest/mirror/target/store means fetch/install could not have been dispatched by this adapter.
  const { lockedTarballs, downloaded, prefix } = await readReconciliationArchives(
    store.root,
    path,
    artifact,
    input.lock,
  );
  // A checksum-valid final download may fail expansion BEFORE the publisher increments its counter.
  // Only that one final original-lock-prefix tarball may be physically present but unjournaled.
  const finalDownload = artifact.files.find(
    (file) => file.path === `tarballs/${prefix.at(-1)}.tgz`,
  );
  const unjournaledDownloadBytes = artifact.bytes - entry.bytes;
  if (
    !artifact.files.some((file) => file.path === 'pnpm.tgz' && file.bytes > 0) ||
    entry.bytes <= 0 ||
    !downloaded.length ||
    (unjournaledDownloadBytes !== 0 && unjournaledDownloadBytes !== finalDownload?.bytes)
  )
    fail('positive_publication_evidence_required');
  const accounting = await readReconciliationAccounting(
    path,
    entry,
    lockedTarballs.slice(0, prefix.length),
    finalDownload!.bytes,
    unjournaledDownloadBytes,
    failure,
  );
  return freezeReconciliation({
    accounting,
    artifact,
    stage,
    scratch,
    scratchPath,
    downloadedTarballs: prefix,
    journaledBytes: entry.bytes,
    physicalBytes: artifact.bytes,
    unjournaledDownloadBytes,
    originalInputVersion: expectedInputVersion,
    phase: 'public-downloads-only-packaged-version-child-closed' as const,
  });
}
