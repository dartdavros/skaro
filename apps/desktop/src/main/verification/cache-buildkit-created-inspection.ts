import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { relative } from 'node:path';
import type { ManagedCacheStore } from '../managed-cache-store';
import { cacheTree } from '../managed-cache-files';
import { encodeNativeIdentity } from '../managed-native-identity';
import {
  inspectOwnedBuilderContainer,
  builderCommand,
  builderEnvironment,
} from '../managed-buildkit-identity';
import {
  requireApprovedBuildkitClient,
  CACHE_BUILDKIT_OWNER_APPROVAL as owner,
} from './cache-buildkit-approval';

export const CREATED_CONTAINER = '3bb4530634a3b50302151ec32b9634bd601e3240a4785225663c4ae70d3168e0';
export const CREATED_INTENT = '6d8c9c2c-d207-4e66-8486-f6c38bb5f692';
export const CREATED_KEY = `resources.cache-buildkit-created.${owner.projectId}.${CREATED_INTENT}.v1`;

/** Accept exactly the actual empty Docker archive shape, never an archive with hidden/PAX/link entries. */
export function requireEmptyBuildkitVolume(bytes: Buffer) {
  assert.equal(bytes.length, 1536);
  const header = bytes.subarray(0, 512);
  const field = (start: number, end: number) =>
    header.subarray(start, end).toString('utf8').split('\0')[0]!;
  const octal = (start: number, end: number) => {
    const text = field(start, end).trim();
    assert(/^[0-7]+$/.test(text));
    return Number.parseInt(text, 8);
  };
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i]!;
  assert.equal(octal(148, 156), checksum);
  assert.equal(field(0, 100), 'buildkit/');
  assert.equal(header[156], 53);
  assert.equal(octal(124, 136), 0);
  assert.equal(field(157, 257), '');
  assert.equal(field(345, 500), '');
  assert(bytes.subarray(512).every((byte) => byte === 0));
  return createHash('sha256').update(bytes).digest('hex');
}

/** Read-only domain evidence. No exec, temporary helper container, write, extraction or adopted RUN. */
export async function inspectCreatedBuildkit(
  store: ManagedCacheStore,
  kind: 'created' | 'stopped' = 'created',
) {
  const entry = store.builders().find((item) => item.projectId === owner.projectId)!;
  assert.equal(entry.container, CREATED_CONTAINER);
  assert.equal(entry.generation, 1);
  assert.equal(entry.state, 'retained');
  assert(entry.client);
  requireApprovedBuildkitClient(entry.client);
  assert.equal((await inspectOwnedBuilderContainer(store, entry, true)).observed.running, false);
  const state = JSON.parse(
    await builderCommand(
      store,
      entry,
      ['container', 'inspect', CREATED_CONTAINER, '--format', '{{json .State}}'],
      true,
    ),
  );
  assert.equal(state.Status, kind === 'created' ? 'created' : 'exited');
  assert.equal(state.Running, false);
  assert.equal(state.Pid, 0);
  if (kind === 'created') assert.equal(state.StartedAt, '0001-01-01T00:00:00Z');
  else {
    assert.notEqual(state.StartedAt, '0001-01-01T00:00:00Z');
    assert.notEqual(state.FinishedAt, '0001-01-01T00:00:00Z');
    assert.equal(state.OOMKilled, false);
    assert.equal(state.Dead, false);
  }
  const root = store.builderPath(entry.projectId),
    env = await builderEnvironment(store, entry);
  const { stdout } = await promisify(execFile)(
    entry.client.docker,
    ['container', 'cp', `${CREATED_CONTAINER}:/var/lib/buildkit`, '-'],
    {
      cwd: root,
      env,
      windowsHide: true,
      timeout: 20_000,
      maxBuffer: kind === 'created' ? 64 * 1024 : 16 * 1024 ** 2,
      encoding: 'buffer',
    },
  );
  const volumeDigest =
    kind === 'created'
      ? requireEmptyBuildkitVolume(stdout)
      : createHash('sha256').update(stdout).digest('hex');
  const after = JSON.parse(
    await builderCommand(
      store,
      entry,
      ['container', 'inspect', CREATED_CONTAINER, '--format', '{{json .State}}'],
      true,
    ),
  );
  assert.deepEqual(after, state);
  const tree = await cacheTree(store.root, root, kind === 'created' ? 1024 ** 2 : 129 * 1024 ** 2);
  assert(tree.nodes.size <= (kind === 'created' ? 32 : 4096 + 64));
  const layout = [...tree.nodes].map(([path, node]) => ({
    path: relative(root, path),
    identity: encodeNativeIdentity(node.native),
    mode: node.native.mode.toString(),
    bytes: node.native.size.toString(),
    mtime: node.native.mtimeNs.toString(),
    ...(node.children ? { children: node.children } : {}),
  }));
  return { entry, volumeDigest, layout, digest: tree.digest, state };
}
