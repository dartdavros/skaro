import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { openPinnedArchiveDatabase, pinArchiveDatabase } from './cache-archive-database';
import {
  CACHE_VERIFICATION_OWNER_SCOPE as scope,
  cacheVerificationProject,
} from './cache-verification-scope';
import { loadSixthArchiveJournal, saveSixthArchiveJournal } from './cache-archive-sixth-journal';
import { readSixthArchivePlan } from './cache-archive-sixth-plan';
import { inspectSixthArchiveState } from './cache-archive-sixth-inspection';

/** Preflight reads the real retained generation. No AppState, migrations or recovery on readonly open. */
export async function openSixthArchiveDatabase(
  data: string,
  preflight: boolean,
  progress: (phase: string) => void = () => undefined,
) {
  const pin = await pinArchiveDatabase(data);
  const registry = openPinnedArchiveDatabase(data, pin, true);
  let writable: ReturnType<typeof openPinnedArchiveDatabase> | undefined;
  try {
    registry.shell.scopeTo(scope.projectId);
    await cacheVerificationProject(registry);
    const existing = loadSixthArchiveJournal(registry, data);
    const journal = existing ?? (await readSixthArchivePlan(registry, data, progress));
    assert.deepEqual(journal.databaseIdentity, pin);
    progress('archive-readonly-domain-and-snapshot-preflight');
    await inspectSixthArchiveState(registry, data, journal);
    if (preflight) return { db: registry, journal };
    registry.close();
    writable = openPinnedArchiveDatabase(data, pin, false);
    writable.shell.scopeTo(scope.projectId);
    await cacheVerificationProject(writable);
    progress('archive-writable-domain-and-snapshot-preflight');
    assert(
      isDeepStrictEqual(loadSixthArchiveJournal(writable, data), existing),
      'Archive journal changed during open',
    );
    await inspectSixthArchiveState(writable, data, journal);
    if (!existing) saveSixthArchiveJournal(writable, data, journal);
    return { db: writable, journal };
  } catch (error) {
    writable?.close();
    try {
      registry.close();
    } catch {
      /* already closed */
    }
    throw error;
  }
}
