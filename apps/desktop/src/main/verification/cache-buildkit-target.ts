import assert from 'node:assert/strict';
import type { ManagedCacheStore } from '../managed-cache-store';
import { CREATED_KEY, inspectCreatedBuildkit } from './cache-buildkit-created-inspection';
import { createdBuilderTarget } from './cache-buildkit-created-resume';
import { inspectStoppedBuildkit } from './cache-buildkit-stopped-journal';
import { stoppedBuildkitReceipt } from './cache-buildkit-stopped-receipt';
import { stoppedBuilderTarget } from './cache-buildkit-stopped-resume';
import { warmReadyBuildkitTarget } from './cache-buildkit-ready-target';

/** A real archive read wakes Resource Saver before foreign baselines; no container run or settings change. */
export async function warmBuildkitVerificationTarget(store: ManagedCacheStore, projectId: string) {
  const entry = store.builders().find((item) => item.projectId === projectId);
  if (!entry?.container) return undefined;
  if (entry.state === 'ready') return warmReadyBuildkitTarget(store, projectId);
  if (stoppedBuildkitReceipt(store)) {
    const target = stoppedBuilderTarget(store);
    assert.deepEqual(await inspectStoppedBuildkit(store), target.journal.observed);
    return target.entry;
  }
  if (store.db.getSetting<{ complete: boolean } | undefined>(CREATED_KEY, undefined)?.complete) {
    const target = createdBuilderTarget(store);
    assert.deepEqual(await inspectCreatedBuildkit(store), target.journal.observed);
    return target.entry;
  }
  throw new Error('cache_buildkit_exact_reconciled_target_required');
}
