import type { ManagedCacheStore } from '../managed-cache-store';
import type { CreatedJournal } from './cache-buildkit-created-journal';
import { STOPPED_KEY } from './cache-buildkit-stopped-journal';
import { USAGE_KEY } from './cache-buildkit-usage-journal';

/** Explicit known cases, newest first; never adopt arbitrary builder metadata or a worker receipt. */
export function stoppedBuildkitReceipt(store: ManagedCacheStore) {
  for (const key of [USAGE_KEY, STOPPED_KEY]) {
    const journal = store.db.getSetting<CreatedJournal | undefined>(key, undefined);
    if (journal?.complete) return journal;
  }
  return undefined;
}
