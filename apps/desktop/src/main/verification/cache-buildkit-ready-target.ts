import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ManagedCacheStore } from '../managed-cache-store';
import { builderEnvironment, inspectBuilder } from '../managed-buildkit-identity';
import { requireApprovedBuildkitClient } from './cache-buildkit-approval';

/** Normal settled ready lifecycle, not adoption/recovery of an ambiguous old executor. */
export async function warmReadyBuildkitTarget(store: ManagedCacheStore, projectId: string) {
  const entry = store.builders().find((item) => item.projectId === projectId)!;
  assert.equal(entry.state, 'ready');
  assert(!entry.consumer && entry.client && entry.container);
  requireApprovedBuildkitClient(entry.client);
  const current = store.current(entry);
  assert.equal(current.state, 'available');
  assert.equal(current.consumers.length, 0);
  assert.equal(store.db.resources.cleanup.read(current.id), undefined);
  assert(Number.isSafeInteger(entry.bytes) && entry.bytes! >= 0);
  const root = store.builderPath(projectId);
  await lstat(join(root, 'context')).then(
    () => {
      throw new Error('cache_buildkit_unsettled_context_retained');
    },
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    },
  );
  assert.equal((await inspectBuilder(store, entry)).running, false);
  // A real bounded archive read wakes Resource Saver before the foreign baseline.
  // Read only the daemon's own static config, not the potentially GiB-sized cache volume.
  const { stdout } = await promisify(execFile)(
    entry.client.docker,
    ['container', 'cp', `${entry.container}:/buildkitd.toml`, '-'],
    {
      cwd: root,
      env: await builderEnvironment(store, entry),
      windowsHide: true,
      timeout: 20_000,
      maxBuffer: 16 * 1024,
      encoding: 'buffer',
    },
  );
  assert(stdout.length >= 1024);
  assert.equal((await inspectBuilder(store, entry)).running, false);
  assert.deepEqual(
    store.builders().find((item) => item.projectId === projectId),
    entry,
  );
  return entry;
}
