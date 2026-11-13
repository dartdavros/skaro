import type { AppDb } from '@skaro/core';
import type { TaskRuns } from './tasks';
import { ManagedCaches } from './managed-caches';
import { managedCacheTools } from './managed-cache-tools';

export function managedCacheServices(db: AppDb, dataDir: string, runs: () => TaskRuns) {
  const managedCaches = new ManagedCaches(db, dataDir);
  return { managedCaches, cacheTools: managedCacheTools(db, dataDir, managedCaches, runs) };
}
