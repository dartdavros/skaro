import assert from 'node:assert/strict';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppDb } from '@skaro/core';
import { ApplicationResources } from '../application-resources';
import { pinArchiveDatabase, openPinnedArchiveDatabase } from './cache-archive-database';
import {
  CACHE_VERIFICATION_OWNER_SCOPE as scope,
  cacheVerificationProject,
} from './cache-verification-scope';
import { cacheBuildkitFailure } from './cache-buildkit-contract';
import { reconcileBuildkitInitialization } from './cache-buildkit-initialization-run';
import {
  INITIALIZATION_KEY,
  initializationProof,
  type InitializationJournal,
} from './cache-buildkit-initialization';
import type { CreatedJournal } from './cache-buildkit-created-journal';
import {
  createdBuildkitCase,
  stoppedBuildkitCase,
  usageBuildkitCase,
} from './cache-buildkit-reconciliation-case';
import { reconcileInactiveBuildkit } from './cache-buildkit-reconciliation-run';

app.setName('Skaro');
if (!app.requestSingleInstanceLock()) app.exit(2);
app.on('window-all-closed', () => undefined);
void app
  .whenReady()
  .then(async () => {
    assert.equal(process.env.SKARO_RC3_CACHE_PROJECT, scope.projectId);
    const phase = process.env.SKARO_RC3_CACHE_PHASE;
    assert(
      [
        'buildkit-initialization-recovery',
        'buildkit-created-recovery',
        'buildkit-stopped-recovery',
        'buildkit-usage-recovery',
      ].includes(phase!),
    );
    const contract =
      phase === 'buildkit-usage-recovery'
        ? usageBuildkitCase
        : phase === 'buildkit-created-recovery'
          ? createdBuildkitCase
          : phase === 'buildkit-stopped-recovery'
            ? stoppedBuildkitCase
            : undefined;
    const journalKey = contract?.key ?? INITIALIZATION_KEY;
    const data = app.getPath('userData'),
      id = randomUUID();
    const directory = join(data, 'verification', `cache-buildkit-reconciliation-${id}`);
    await mkdir(directory, { recursive: true });
    const proof: Record<string, unknown> = { id, startedAt: new Date().toISOString() };
    let db: AppDb | undefined,
      resources: ApplicationResources | undefined,
      code = 1;
    try {
      const pin = await pinArchiveDatabase(data);
      db = openPinnedArchiveDatabase(data, pin, true);
      db.shell.scopeTo(scope.projectId);
      await cacheVerificationProject(db);
      const failed = await (contract ? contract.failedProof(data, db) : initializationProof(data));
      const journal = db.getSetting<InitializationJournal | CreatedJournal | undefined>(
        journalKey,
        undefined,
      );
      const allowed = new Set([
        ...failed.finalLeases.map((lease) => lease.id),
        ...(journal?.controls ?? []),
      ]);
      assert(
        !db.admission
          .all()
          .some(
            (lease) =>
              lease.projectId === scope.projectId &&
              !['released', 'cancelled', 'stopped_by_owner'].includes(lease.state) &&
              !allowed.has(lease.id),
          ),
      );
      db.close();
      db = openPinnedArchiveDatabase(data, pin, false);
      db.shell.scopeTo(scope.projectId);
      resources = new ApplicationResources(db, data);
      const before = journal?.complete ? { journal, leases: db.admission.all() } : undefined;
      proof.result = contract
        ? await reconcileInactiveBuildkit(db, resources, data, contract)
        : await reconcileBuildkitInitialization(db, resources, data, id);
      if (before) {
        assert.deepEqual(db.getSetting(journalKey, undefined), before.journal);
        assert.deepEqual(db.admission.all(), before.leases);
        proof.replayUnchanged = true;
      }
      assert(
        !db.admission
          .all()
          .some(
            (lease) =>
              lease.projectId === scope.projectId &&
              !['released', 'cancelled', 'stopped_by_owner'].includes(lease.state),
          ),
      );
      code = 0;
    } catch (error) {
      proof.error = cacheBuildkitFailure(error);
      process.send?.({ error: proof.error });
    } finally {
      try {
        await resources?.close();
      } catch (error) {
        code = 1;
        proof.closeError = cacheBuildkitFailure(error);
      }
      if (db) {
        proof.journal = db.getSetting(journalKey, undefined);
        proof.finalLeases = db.admission
          .all()
          .filter((lease) => lease.projectId === scope.projectId);
        db.close();
      }
      proof.passed = code === 0;
      proof.finishedAt = new Date().toISOString();
      const file = join(directory, 'proof.json');
      await writeFile(file, JSON.stringify(proof, null, 2), { flag: 'wx', mode: 0o600 });
      process.send?.({ proof: file, passed: proof.passed });
      app.exit(code);
    }
  })
  .catch((error) => {
    console.error(cacheBuildkitFailure(error));
    app.exit(1);
  });
