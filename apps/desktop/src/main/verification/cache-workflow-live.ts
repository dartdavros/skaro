import assert from 'node:assert/strict';
import { app } from 'electron';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppDb } from '@skaro/core';
import { ApplicationResources } from '../application-resources';
import { ManagedCacheStore } from '../managed-cache-store';
import { ManagedCacheExecution } from '../managed-cache-execution';
import { ManagedBuildkitCache } from '../managed-buildkit-cache';
import { ManagedPnpmCache } from '../managed-pnpm-cache';
import { observeManagedDockerClient } from '../managed-docker-observation';
import {
  openCacheVerificationDatabase,
  CACHE_VERIFICATION_OWNER_SCOPE,
} from './cache-verification-scope';
import { withCacheVerificationSource } from './cache-verification-source';
import { verifyDependencyCache } from './cache-verification-dependencies';
import { protectedFingerprint } from './reclamation-observation';
import { resourceInventory } from './resource-workflow-observation';

app.setName('Skaro');
if (!app.requestSingleInstanceLock()) {
  console.error('Close the other Skaro instance before authorized cache verification');
  app.exit(2);
}
app.on('window-all-closed', () => undefined);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function projectState(db: AppDb) {
  const projectId = CACHE_VERIFICATION_OWNER_SCOPE.projectId;
  return hash([
    db.shell.get(projectId),
    db.listRuns(projectId),
    [...db.getTaskRuntime(projectId)].sort(),
  ]);
}
void app
  .whenReady()
  .then(async () => {
    assert.equal(process.env.SKARO_RC3_CACHE_PROJECT, CACHE_VERIFICATION_OWNER_SCOPE.projectId);
    assert.equal(process.env.SKARO_RC3_CACHE_PHASE, 'dependencies');
    const data = app.getPath('userData'),
      intentId = randomUUID();
    const directory = join(data, 'verification', `cache-workflow-${intentId}`);
    await mkdir(directory, { recursive: true });
    const proof: Record<string, unknown> = {
      projectId: CACHE_VERIFICATION_OWNER_SCOPE.projectId,
      intentId,
      phase: 'dependencies',
      startedAt: new Date().toISOString(),
    };
    let db: AppDb | undefined,
      resources: ApplicationResources | undefined,
      code = 1;
    const shutdown = new AbortController();
    try {
      db = await openCacheVerificationDatabase(data);
      const docker = await observeManagedDockerClient(data);
      proof.observedLocalDocker = docker;
      for (const name of ['DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'])
        delete process.env[name];
      process.env.DOCKER_HOST = docker.host;
      resources = new ApplicationResources(db, data);
      const store = new ManagedCacheStore(db, data);
      const execution = new ManagedCacheExecution(
        store,
        new ManagedBuildkitCache(store),
        data,
        shutdown.signal,
      );
      await withCacheVerificationSource(
        db,
        resources,
        async (source) => {
          proof.source = {
            root: source.root,
            head: source.head,
            resourceId: source.resourceId,
            generation: source.generation,
          };
          const before = await protectedFingerprint(db!, source.projectId, source.root, data, []);
          const foreign = await resourceInventory(source.root),
            state = projectState(db!);
          proof.protectedBefore = before;
          proof.foreignBefore = foreign;
          proof.projectStateBefore = state;
          try {
            await verifyDependencyCache(
              store,
              execution,
              new ManagedPnpmCache(store),
              source,
              data,
              proof,
            );
          } finally {
            const after = await protectedFingerprint(db!, source.projectId, source.root, data, []);
            const foreignAfter = await resourceInventory(source.root);
            proof.protectedAfter = after;
            proof.foreignAfter = foreignAfter;
            proof.projectStateAfter = projectState(db!);
            assert.deepEqual(after, before, 'Source/history/branches must remain byte-identical');
            assert.deepEqual(
              foreignAfter,
              foreign,
              'Existing Docker objects/worktrees must remain unchanged',
            );
            assert.equal(
              proof.projectStateAfter,
              state,
              'Project/run/runtime records must remain unchanged',
            );
          }
        },
        { intentId },
      );
      const leases = db.admission.all().filter((lease) => lease.intentId === intentId);
      proof.leases = leases;
      assert(leases.length >= 5 && leases.every((lease) => lease.state === 'released'));
      proof.scenarioPassed = true;
      code = 0;
    } catch (error) {
      proof.error = error instanceof Error ? error.stack : String(error);
      process.send?.({ error: proof.error });
    } finally {
      shutdown.abort();
      try {
        await resources?.close();
      } catch (error) {
        code = 1;
        proof.closeError = String(error);
      }
      if (db) {
        proof.finalLeases = db.admission.all().filter((lease) => lease.intentId === intentId);
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
