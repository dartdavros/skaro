import assert from 'node:assert/strict';
import type { AppDb } from '@skaro/core';
import { snapshotArchiveSources } from '../managed-verification-archive-snapshot';
import { manifestText } from '../managed-verification-archive-metadata';
import {
  reopenVerifiedArchive,
  inspectArchivedSources,
  type VerifiedArchive,
} from '../managed-verification-archive-store';
import { archiveEqual } from './cache-archive-sixth-identity';
import type { SixthArchiveJournal } from './cache-archive-sixth-journal';
import { assertSixthDomain } from './cache-archive-sixth-authority';

/** Read-only verification. It never turns the old producer target into a new install capability. */
export async function inspectSixthArchiveState(
  db: AppDb,
  data: string,
  j: SixthArchiveJournal,
  verified?: VerifiedArchive,
  controllerId?: string,
) {
  let absent = { artifact: false, scratch: false, stage: false };
  if (j.backup) {
    const capability =
      verified ??
      (await reopenVerifiedArchive({
        database: db,
        expectedArchiveId: j.archiveId,
        expectedProjectId: j.project.projectId,
        expectedSubjectIntent: j.original.entry.consumer!.intent,
        expectedDatabaseIdentity: j.databaseIdentity,
        expectedManifestDigest: j.backup.manifestDigest,
        durability: 'verify-only',
        expectedRoots: j.roots,
        hostGate: () => {
          assert.equal(db.shell.projectScope, j.project.projectId);
        },
      }));
    absent = { ...(await inspectArchivedSources(capability)).absent };
  } else
    archiveEqual(
      manifestText(await snapshotArchiveSources(j.roots)),
      manifestText(j.snapshot),
      'unarchived_source_changed',
    );
  return assertSixthDomain(db, data, j, absent, controllerId);
}
