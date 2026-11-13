import type { AppDb } from '@skaro/core';
import {
  validateCacheReconciliationJournal,
  type CacheReconciliationJournal,
} from './cache-verification-reconciliation-journal';

/** Completed physical recovery is durable BEFORE closing control accounting; repeat this after a crash. */
export async function settleCompletedCacheControls(
  db: AppDb,
  data: string,
  journal: CacheReconciliationJournal,
  currentControllerId?: string,
) {
  if (journal.state !== 'complete') throw new Error('cache_reconciliation_not_physically_complete');
  await validateCacheReconciliationJournal(db, data, journal, currentControllerId);
  for (const preparation of journal.preparations) {
    if (preparation.request.id === currentControllerId) continue;
    const old = db.admission.get(journal.project.projectId, preparation.request.id);
    if (!old || ['released', 'cancelled', 'stopped_by_owner'].includes(old.state)) continue;
    // The ordinary startup constructor retains known dead-process grants; never reuse one as authority.
    if (old.state !== 'retained') throw new Error('cache_reconciliation_control_not_retained');
    const generations = Object.fromEntries(
      old.locks.map((lock) => {
        const actual = db.resources.get(lock.resourceId);
        if (!actual || actual.generation !== lock.generation)
          throw new Error('cache_reconciliation_generation_changed');
        return [lock.resourceId, lock.generation];
      }),
    );
    db.admission.release(
      old.projectId,
      old.id,
      old.revision,
      generations,
      'completed_public_downloads_recovery_control_accounting_settled',
    );
    await validateCacheReconciliationJournal(db, data, journal, currentControllerId);
  }
}
