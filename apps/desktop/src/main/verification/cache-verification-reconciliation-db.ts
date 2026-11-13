import { AppDb } from '@skaro/core';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  cacheVerificationProject,
  openCacheVerificationDatabase,
  CACHE_VERIFICATION_OWNER_SCOPE,
} from './cache-verification-scope';
import { readCacheReconciliationPlan } from './cache-verification-reconciliation-plan';
import {
  createCacheReconciliationJournal,
  loadCacheReconciliationJournal,
  validateCacheReconciliationJournal,
} from './cache-verification-reconciliation-journal';

/** Separate operator gate. Ordinary cache admission still rejects any pre-existing nonterminal lease. */
export async function openCacheReconciliationDatabase(data: string, failedIntent?: string) {
  const registry = await openCacheVerificationDatabase(data, true);
  let db: AppDb | undefined;
  try {
    const existing = loadCacheReconciliationJournal(registry, failedIntent);
    const original = existing
      ? undefined
      : await readCacheReconciliationPlan(registry, data, failedIntent);
    if (existing) await validateCacheReconciliationJournal(registry, data, existing);
    registry.close();
    db = AppDb.open(join(data, 'skaro.db'));
    db.shell.scopeTo(CACHE_VERIFICATION_OWNER_SCOPE.projectId);
    await cacheVerificationProject(db);
    const current = loadCacheReconciliationJournal(db, failedIntent);
    if (!isDeepStrictEqual(current, existing)) throw new Error('cache_reconciliation_gate_changed');
    const journal = existing ?? (await createCacheReconciliationJournal(db, original!));
    await validateCacheReconciliationJournal(db, data, journal);
    return { db, journal };
  } catch (error) {
    db?.close();
    // close() tolerates an already closed readonly registry, but do not mask the actual gate failure.
    try {
      registry.close();
    } catch {
      /* already closed */
    }
    throw error;
  }
}
