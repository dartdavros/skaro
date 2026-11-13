import assert from 'node:assert/strict';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppDb } from '@skaro/core';
import { ApplicationResources } from '../application-resources';
import { openSixthArchiveDatabase } from './cache-archive-sixth-db';
import { runSixthArchiveRecovery } from './cache-archive-sixth-run';
import {
  CACHE_VERIFICATION_OWNER_SCOPE as scope,
  cacheVerificationProject,
} from './cache-verification-scope';
import { protectedFingerprint } from './reclamation-observation';
import { resourceInventory } from './resource-workflow-observation';
import { cacheBuildkitProjectState } from './cache-buildkit-contract';
import { loadSixthArchiveJournal } from './cache-archive-sixth-journal';

app.setName('Skaro');
if (!app.requestSingleInstanceLock()) {
  console.error('Close the other Skaro instance before cache recovery');
  app.exit(2);
}
app.on('window-all-closed', () => undefined);
void app
  .whenReady()
  .then(async () => {
    assert.equal(process.env.SKARO_RC3_CACHE_PROJECT, scope.projectId);
    const phase = process.env.SKARO_RC3_CACHE_PHASE;
    assert(['archive-sixth-preflight', 'archive-sixth-recovery'].includes(phase!));
    const preflight = phase === 'archive-sixth-preflight',
      data = app.getPath('userData'),
      id = randomUUID();
    const proof: Record<string, unknown> = {
      id,
      phase,
      projectId: scope.projectId,
      startedAt: new Date().toISOString(),
    };
    let db: AppDb | undefined,
      resources: ApplicationResources | undefined,
      code = 1;
    try {
      const opened = await openSixthArchiveDatabase(data, preflight, (progress) =>
        process.send?.({ progress, id }),
      );
      db = opened.db;
      const project = await cacheVerificationProject(db);
      const before = await protectedFingerprint(db, project.projectId, project.root, data, []);
      const foreign = await resourceInventory(project.root);
      const projectState = cacheBuildkitProjectState(db);
      const replayBefore =
        opened.journal.state === 'complete'
          ? {
              journal: loadSixthArchiveJournal(db, data),
              leases: db.admission.all().filter((lease) => lease.projectId === scope.projectId),
            }
          : undefined;
      proof.protectedBefore = before;
      proof.foreignBefore = foreign;
      proof.projectStateBefore = projectState;
      proof.snapshotDigest = opened.journal.snapshotDigest;
      proof.archiveId = opened.journal.archiveId;
      proof.allocation = opened.journal.allocation;
      if (preflight)
        proof.result = {
          preflight: true,
          state: opened.journal.state,
          originalBytes: opened.journal.snapshot.totalBytes,
        };
      else {
        resources = new ApplicationResources(db, data);
        try {
          proof.result = await runSixthArchiveRecovery(
            db,
            resources,
            data,
            opened.journal,
            id,
            (progress) => process.send?.({ progress, id }),
          );
          if (replayBefore) {
            assert.deepEqual(
              loadSixthArchiveJournal(db, data),
              replayBefore.journal,
              'Complete replay must not rewrite its journal',
            );
            assert.deepEqual(
              db.admission.all().filter((lease) => lease.projectId === scope.projectId),
              replayBefore.leases,
              'Settled replay must not create or revise leases',
            );
            proof.replayUnchanged = true;
          }
        } finally {
          const after = await protectedFingerprint(db, project.projectId, project.root, data, []);
          const foreignAfter = await resourceInventory(project.root);
          proof.protectedAfter = after;
          proof.foreignAfter = foreignAfter;
          proof.projectStateAfter = cacheBuildkitProjectState(db);
          assert.deepEqual(after, before, 'Source/history/refs must remain unchanged');
          assert.deepEqual(foreignAfter, foreign, 'Foreign Docker/worktrees must remain unchanged');
          assert.equal(
            proof.projectStateAfter,
            projectState,
            'Project/run/runtime records must remain unchanged',
          );
        }
      }
      code = 0;
    } catch (error) {
      proof.error = error instanceof Error ? error.stack : String(error);
    } finally {
      try {
        await resources?.close();
      } catch (error) {
        code = 1;
        proof.closeError = String(error);
      }
      if (db) {
        proof.finalLeases = db.admission
          .all()
          .filter((lease) => lease.projectId === scope.projectId);
        db.close();
      }
      proof.passed = code === 0;
      proof.finishedAt = new Date().toISOString();
      if (preflight) process.send?.({ preflight: proof });
      else {
        const directory = join(data, 'verification', `cache-archive-reconciliation-${id}`);
        await mkdir(directory, { recursive: true });
        const file = join(directory, 'proof.json');
        await writeFile(file, JSON.stringify(proof, null, 2), { flag: 'wx', mode: 0o600 });
        process.send?.({ proof: file, passed: proof.passed, error: proof.error });
      }
      app.exit(code);
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
