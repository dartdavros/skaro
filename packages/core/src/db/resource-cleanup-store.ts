import type { DatabaseSync } from 'node:sqlite';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ResourceIdentity } from '../resources/model.ts';
import type { ResourceCleanupFence } from '../resources/cleanup-context.ts';

const PREFIX = 'resource.cleanup.fence.';
export const cleanupFenceKey = (id: string) => `${PREFIX}${id}`;
function overlaps(a: ResourceIdentity, b: ResourceIdentity): boolean {
  if (a.composeProject && a.composeProject === b.composeProject) return true;
  if (!a.path || !b.path) return false;
  const contains = (parent: string, child: string) => {
    const path = relative(resolve(parent), resolve(child));
    return !path || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
  };
  return contains(a.path, b.path) || contains(b.path, a.path);
}

/** Existing settings storage; no lazy schema migration, TTL, or read-side lock deletion. */
export class CleanupFenceStore {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }
  read(id: string): ResourceCleanupFence | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(cleanupFenceKey(id));
    if (!row) return undefined;
    let fence: ResourceCleanupFence;
    try {
      fence = JSON.parse(String(row.value)) as ResourceCleanupFence;
    } catch {
      throw new Error('Malformed resource cleanup fence; reconciliation required');
    }
    if (
      !fence ||
      fence.resourceId !== id ||
      !Number.isSafeInteger(fence.generation) ||
      fence.generation < 1 ||
      !Number.isSafeInteger(fence.pid) ||
      fence.pid < 1 ||
      ![fence.operationId, fence.token, fence.owner, fence.signature].every(
        (value) => typeof value === 'string' && !!value,
      ) ||
      typeof fence.externalPending !== 'boolean' ||
      !fence.identity ||
      !Array.isArray(fence.objectIds) ||
      !fence.objectIds.every((id) => typeof id === 'string' && !!id) ||
      (!fence.identity.path && !fence.identity.composeProject) ||
      (fence.authorityLeaseId !== undefined && typeof fence.authorityLeaseId !== 'string') ||
      !['remove', 'maintenance', 'stop'].includes(fence.mode) ||
      !['claimed', 'running', 'retry', 'verified'].includes(fence.state)
    )
      throw new Error('Malformed resource cleanup fence; reconciliation required');
    return fence;
  }
  blocking(
    identity: ResourceIdentity,
    objectIds: readonly string[] = [],
  ): ResourceCleanupFence | undefined {
    for (const row of this.db
      .prepare('SELECT key FROM settings WHERE key LIKE ?')
      .all(`${PREFIX}%`)) {
      const fence = this.read(String(row.key).slice(PREFIX.length));
      if (
        fence &&
        (overlaps(identity, fence.identity) || objectIds.some((id) => fence.objectIds.includes(id)))
      )
        return fence;
    }
    return undefined;
  }
  atomic<T>(action: () => T): T {
    this.db.exec('SAVEPOINT resource_cleanup_write');
    try {
      // Acquire SQLite's writer lock before checking exclusion or consumer snapshots.
      this.db
        .prepare('UPDATE settings SET value=value WHERE key=?')
        .run('resource.cleanup.writer-lock');
      const result = action();
      this.db.exec('RELEASE resource_cleanup_write');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK TO resource_cleanup_write');
      this.db.exec('RELEASE resource_cleanup_write');
      throw error;
    }
  }
  save(fence: ResourceCleanupFence): void {
    this.db
      .prepare(
        'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(cleanupFenceKey(fence.resourceId), JSON.stringify(fence));
  }
}
