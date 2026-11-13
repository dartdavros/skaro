import assert from 'node:assert/strict';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppDb } from '@skaro/core';
import { ApplicationResources } from '../application-resources';
import { ManagedCacheStore } from '../managed-cache-store';
import { ManagedCacheExecution } from '../managed-cache-execution';
import { ManagedBuildkitCache } from '../managed-buildkit-cache';
import { observeManagedDockerClient } from '../managed-docker-observation';
import {
  openCacheVerificationDatabase,
  CACHE_VERIFICATION_OWNER_SCOPE as scope,
} from './cache-verification-scope';
import { withCacheVerificationSource } from './cache-verification-source';
import { protectedFingerprint } from './reclamation-observation';
import { resourceInventory } from './resource-workflow-observation';
import { verifyBuildkitCache } from './cache-verification-buildkit';
import {
  requireCacheBuildkitOptIn,
  requireApprovedBuildkitClient,
} from './cache-buildkit-approval';
import { cacheBuildkitFailure, cacheBuildkitProjectState } from './cache-buildkit-contract';
import { existingBuildkitObjects, requireBuildkitInventory } from './cache-buildkit-preservation';
import { warmBuildkitVerificationTarget } from './cache-buildkit-target';
import { builderVolumeName } from '../managed-buildkit-policy';

app.setName('Skaro');
if (!app.requestSingleInstanceLock()) {
  console.error('Close the other Skaro instance before cache verification');
  app.exit(2);
}
app.on('window-all-closed', () => undefined);
void app
  .whenReady()
  .then(async () => {
    requireCacheBuildkitOptIn();
    const data = app.getPath('userData'),
      intentId = randomUUID();
    const directory = join(data, 'verification', `cache-buildkit-${intentId}`);
    await mkdir(directory, { recursive: true });
    const proof: Record<string, unknown> = {
      intentId,
      projectId: scope.projectId,
      startedAt: new Date().toISOString(),
    };
    let db: AppDb | undefined,
      resources: ApplicationResources | undefined,
      code = 1;
    const shutdown = new AbortController();
    try {
      db = await openCacheVerificationDatabase(data);
      const client = await observeManagedDockerClient(data);
      requireApprovedBuildkitClient(client);
      for (const name of ['DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'])
        delete process.env[name];
      process.env.DOCKER_HOST = client.host;
      resources = new ApplicationResources(db, data);
      const store = new ManagedCacheStore(db, data),
        cache = new ManagedBuildkitCache(store);
      const execution = new ManagedCacheExecution(store, cache, data, shutdown.signal);
      await withCacheVerificationSource(
        db,
        resources,
        async (source) => {
          const owned = await warmBuildkitVerificationTarget(store, source.projectId);
          const before = await protectedFingerprint(db!, source.projectId, source.root, data, []);
          const inventory = await resourceInventory(source.root, client);
          const protectedInventory = {
            ...inventory,
            containers: inventory.containers.filter((id) => id !== owned?.container),
            volumes: inventory.volumes.filter((id) => !owned || id !== builderVolumeName(owned)),
          };
          const foreign = await existingBuildkitObjects(source.root, protectedInventory, client);
          const state = cacheBuildkitProjectState(db!);
          proof.protectedBefore = before;
          proof.foreignBefore = inventory;
          proof.objectsBefore = foreign;
          if (owned)
            proof.mutableOwnedTarget = {
              resourceId: owned.resourceId,
              generation: owned.generation,
              container: owned.container,
              volume: builderVolumeName(owned),
            };
          try {
            await verifyBuildkitCache(store, execution, cache, source, proof, (progress) =>
              process.send?.({ progress, intentId }),
            );
          } catch (error) {
            proof.scenarioError = cacheBuildkitFailure(error);
            throw error;
          } finally {
            const after = await protectedFingerprint(db!, source.projectId, source.root, data, []);
            proof.protectedAfter = after;
            const inventoryAfter = await resourceInventory(source.root, client);
            proof.foreignAfter = inventoryAfter;
            const objects = await existingBuildkitObjects(source.root, protectedInventory, client);
            proof.objectsAfter = objects;
            assert.deepEqual(after, before);
            assert.deepEqual(objects, foreign);
            assert.equal(cacheBuildkitProjectState(db!), state);
            requireBuildkitInventory(
              inventory,
              inventoryAfter,
              store.builders().find((entry) => entry.projectId === source.projectId),
            );
          }
        },
        { intentId },
      );
      const leases = db.admission.all().filter((lease) => lease.intentId === intentId);
      assert(leases.length >= 4 && leases.every((lease) => lease.state === 'released'));
      proof.scenarioPassed = true;
      code = 0;
    } catch (error) {
      proof.error = cacheBuildkitFailure(error);
      process.send?.({ error: proof.error });
    } finally {
      shutdown.abort();
      try {
        await resources?.close();
      } catch (error) {
        code = 1;
        proof.closeError = cacheBuildkitFailure(error);
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
    console.error(cacheBuildkitFailure(error));
    app.exit(1);
  });
