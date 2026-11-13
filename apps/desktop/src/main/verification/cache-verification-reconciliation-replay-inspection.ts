import type { AppDb } from '@skaro/core';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalCachePath } from '../managed-cache-files';
import { selectManagedCacheContext } from '../managed-cache-context';
import { readManagedPnpmInput } from '../managed-pnpm-provenance';
import {
  cacheVerificationProject,
  CACHE_VERIFICATION_OWNER_SCOPE,
} from './cache-verification-scope';
import {
  reconciliationHash,
  pnpmInputVersion,
  requireNativeAbsence,
} from './cache-verification-reconciliation-layout';
import { reconciliationAttempt } from './cache-verification-reconciliation-identity';
import { assertReplayJournal } from './cache-verification-reconciliation-replay-schema';
import { replayEqual } from './cache-verification-reconciliation-replay-lease';
import { reconciliationRemainder } from './cache-verification-reconciliation-replay-physical';
import {
  readReplayDatabase,
  assertReplayAuthority,
} from './cache-verification-reconciliation-replay-authority';
import { verifyReconciliationProof } from './cache-verification-reconciliation-producer-proof';
import { verifyPreservedReconciliationProofs } from './cache-verification-reconciliation-preserved';
import {
  replayFail as fail,
  type CacheReconciliationJournal,
} from './cache-verification-reconciliation-replay-types';

/** No effects/admission. All absence and source facts are independently read, never accepted as flags. */
export async function inspectReplayJournal(
  db: AppDb,
  data: string,
  journal: CacheReconciliationJournal,
  controllerId?: string,
) {
  assertReplayJournal(journal);
  if (
    db.filePath !== resolve(data, 'skaro.db') ||
    journal.storeRoot !== resolve(data, 'managed-caches-v1') ||
    db.shell.projectScope !== journal.project.projectId
  )
    fail('database_scope');
  await canonicalCachePath(resolve(data), db.filePath);
  const database = await lstat(db.filePath);
  if (!database.isFile() || database.nlink !== 1) fail('private_database_required');
  const project = await cacheVerificationProject(db);
  replayEqual(
    { projectId: project.projectId, root: project.root, head: project.head },
    journal.project,
    'project_changed',
  );
  await canonicalCachePath(project.root, project.root);
  const root = await lstat(project.root);
  if (
    !root.isDirectory() ||
    reconciliationHash(JSON.stringify([root.dev, root.ino, root.birthtimeMs])) !==
      journal.original.sourceResource.source?.dataVersion
  )
    fail('persistent_source_native_identity_changed');
  const selected = await selectManagedCacheContext(
    project.root,
    CACHE_VERIFICATION_OWNER_SCOPE.dependencies,
  );
  const requireInput = async () => {
    if (
      pnpmInputVersion(await readManagedPnpmInput(selected.cwd)) !==
      journal.evidence.originalInputVersion
    )
      fail('current_source_input_changed');
    await selected.requireCurrent();
  };
  await requireInput();
  await requireNativeAbsence(reconciliationAttempt(journal.original));
  if (journal.producerProof) await verifyReconciliationProof(data, journal.producerProof);
  if (journal.preserved) await verifyPreservedReconciliationProofs(data, journal.preserved.proofs);
  const before = readReplayDatabase(db, data, journal);
  const [artifact, scratch, stage] = await Promise.all([
    reconciliationRemainder(journal, 'artifact'),
    reconciliationRemainder(journal, 'scratch'),
    reconciliationRemainder(journal, 'stage'),
  ]);
  const after = readReplayDatabase(db, data, journal);
  replayEqual(before, after, 'database_changed_during_read');
  const status = await assertReplayAuthority(
    journal,
    after,
    { artifact: !artifact, scratch: !scratch, stage: !stage },
    controllerId,
  );
  await project.requireCurrent();
  await requireInput();
  await requireNativeAbsence(reconciliationAttempt(journal.original));
  replayEqual(
    readReplayDatabase(db, data, journal),
    after,
    'database_changed_during_native_checks',
  );
  return status;
}
