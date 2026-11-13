import assert from 'node:assert/strict';
import { app } from 'electron';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppDb } from '@skaro/core';
import { ApplicationResources } from '../application-resources';
import { observeManagedDockerClient } from '../managed-docker-observation';
import { openCacheReconciliationDatabase } from './cache-verification-reconciliation-db';
import { reconcileCacheVerificationFailure } from './cache-verification-reconciliation';
import {
  CACHE_VERIFICATION_OWNER_SCOPE,
  cacheVerificationProject,
} from './cache-verification-scope';
import {
  reconciliationAttempt,
  requireReconciliationIntent,
} from './cache-verification-reconciliation-identity';
import { protectedFingerprint } from './reclamation-observation';
import { resourceInventory } from './resource-workflow-observation';

app.setName('Skaro');
if (!app.requestSingleInstanceLock()) {
  console.error('Close the other Skaro instance before explicit cache reconciliation');
  app.exit(2);
}
app.on('window-all-closed', () => undefined);
const state = (db: AppDb) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        db.shell.get(CACHE_VERIFICATION_OWNER_SCOPE.projectId),
        db.listRuns(CACHE_VERIFICATION_OWNER_SCOPE.projectId),
        [...db.getTaskRuntime(CACHE_VERIFICATION_OWNER_SCOPE.projectId)].sort(),
      ]),
    )
    .digest('hex');
void app
  .whenReady()
  .then(async () => {
    assert.equal(process.env.SKARO_RC3_CACHE_PROJECT, CACHE_VERIFICATION_OWNER_SCOPE.projectId);
    assert.equal(process.env.SKARO_RC3_CACHE_PHASE, 'reconcile-public-downloads');
    const failedIntent = process.env.SKARO_RC3_CACHE_FAILED_INTENT;
    requireReconciliationIntent(failedIntent);
    const data = app.getPath('userData'),
      id = randomUUID();
    const directory = join(data, 'verification', `cache-reconciliation-${id}`);
    await mkdir(directory, { recursive: true });
    const proof: Record<string, unknown> = {
      id,
      failedIntent,
      projectId: CACHE_VERIFICATION_OWNER_SCOPE.projectId,
      startedAt: new Date().toISOString(),
    };
    let db: AppDb | undefined,
      resources: ApplicationResources | undefined,
      code = 1;
    try {
      const opened = await openCacheReconciliationDatabase(data, failedIntent);
      db = opened.db;
      const attempt = reconciliationAttempt(opened.journal.original);
      const source = await cacheVerificationProject(db);
      const docker = await observeManagedDockerClient(data);
      proof.observedLocalDocker = docker;
      for (const name of ['DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'])
        delete process.env[name];
      process.env.DOCKER_HOST = docker.host;
      const before = await protectedFingerprint(db, source.projectId, source.root, data, []);
      const foreign = await resourceInventory(source.root),
        originalState = state(db);
      proof.protectedBefore = before;
      proof.foreignBefore = foreign;
      proof.projectStateBefore = originalState;
      resources = new ApplicationResources(db, data);
      try {
        proof.result = await reconcileCacheVerificationFailure(
          db,
          resources,
          data,
          opened.journal,
          (phase) => process.send?.({ progress: phase, id }),
        );
      } finally {
        const after = await protectedFingerprint(db, source.projectId, source.root, data, []);
        const foreignAfter = await resourceInventory(source.root);
        proof.protectedAfter = after;
        proof.foreignAfter = foreignAfter;
        proof.projectStateAfter = state(db);
        assert.deepEqual(after, before, 'Every source/history/ref must remain byte-identical');
        assert.deepEqual(
          foreignAfter,
          foreign,
          'Existing Docker objects/worktrees must remain unchanged',
        );
        assert.equal(state(db), originalState, 'Project/run/runtime state must remain unchanged');
      }
      const originals = [attempt.sourceLeaseId, attempt.dependenciesLeaseId];
      proof.originalLeases = originals.map((leaseId) =>
        db!.admission.get(source.projectId, leaseId),
      );
      assert(
        originals.every(
          (leaseId) => db!.admission.get(source.projectId, leaseId)?.state === 'released',
        ),
      );
      const finalLeases = db.admission
        .all()
        .filter((lease) => lease.projectId === source.projectId);
      assert(
        finalLeases.every((lease) =>
          ['released', 'cancelled', 'stopped_by_owner'].includes(lease.state),
        ),
        'No original or control reservation/request may remain active',
      );
      assert.equal(
        db.resources.get(attempt.sourceId)?.consumers.length,
        0,
        'The persistent source must have no orphaned recovery reader',
      );
      proof.scenarioPassed = true;
      code = 0;
    } catch (error) {
      proof.error = error instanceof Error ? error.stack : String(error);
      process.send?.({ error: proof.error });
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
          .filter((lease) => lease.projectId === CACHE_VERIFICATION_OWNER_SCOPE.projectId);
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
    console.error(error);
    app.exit(1);
  });
