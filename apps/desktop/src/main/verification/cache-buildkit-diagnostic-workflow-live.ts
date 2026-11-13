import assert from 'node:assert/strict';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ManagedCacheStore } from '../managed-cache-store';
import { inspectOwnedBuilderContainer, builderCommand } from '../managed-buildkit-identity';
import {
  openCacheVerificationDatabase,
  cacheVerificationProject,
} from './cache-verification-scope';
import { cacheBuildkitFailure } from './cache-buildkit-contract';
import { existingBuildkitObjects, requireBuildkitInventory } from './cache-buildkit-preservation';
import { protectedFingerprint } from './reclamation-observation';
import { resourceInventory } from './resource-workflow-observation';

app.setName('Skaro');
if (!app.requestSingleInstanceLock()) app.exit(2);
app.on('window-all-closed', () => undefined);
void app
  .whenReady()
  .then(async () => {
    assert.equal(process.env.SKARO_RC3_CACHE_PHASE, 'buildkit-created-diagnostic');
    const data = app.getPath('userData'),
      id = randomUUID();
    const directory = join(data, 'verification', `cache-buildkit-diagnostic-${id}`);
    await mkdir(directory, { recursive: true });
    const proof: Record<string, unknown> = { id, startedAt: new Date().toISOString() };
    const db = await openCacheVerificationDatabase(data, true);
    let code = 1;
    try {
      const project = await cacheVerificationProject(db),
        store = new ManagedCacheStore(db, data);
      const failed = JSON.parse(
        await readFile(
          join(
            data,
            'verification',
            'cache-buildkit-6d8c9c2c-d207-4e66-8486-f6c38bb5f692',
            'proof.json',
          ),
          'utf8',
        ),
      );
      const entry = store.builders().find((item) => item.projectId === project.projectId)!;
      assert.equal(
        entry.container,
        '3bb4530634a3b50302151ec32b9634bd601e3240a4785225663c4ae70d3168e0',
      );
      proof.owned = await inspectOwnedBuilderContainer(store, entry, true);
      proof.state = JSON.parse(
        await builderCommand(
          store,
          entry,
          ['container', 'inspect', entry.container!, '--format', '{{json .State}}'],
          true,
        ),
      );
      proof.protected = await protectedFingerprint(db, project.projectId, project.root, data, []);
      assert.deepEqual(proof.protected, failed.protectedBefore);
      const inventory = await resourceInventory(project.root, entry.client);
      proof.inventory = inventory;
      requireBuildkitInventory(failed.foreignBefore, inventory, entry);
      proof.foreignObjects = await existingBuildkitObjects(
        project.root,
        failed.foreignBefore,
        entry.client,
      );
      assert.deepEqual(proof.foreignObjects, failed.objectsBefore);
      proof.entry = entry;
      proof.resource = store.current(entry);
      proof.fence = db.resources.cleanup.read(entry.resourceId);
      code = 0;
    } catch (error) {
      proof.error = cacheBuildkitFailure(error);
    } finally {
      db.close();
      proof.passed = code === 0;
      proof.finishedAt = new Date().toISOString();
      const file = join(directory, 'proof.json');
      await writeFile(file, JSON.stringify(proof, null, 2), { flag: 'wx', mode: 0o600 });
      process.send?.({ proof: file, passed: proof.passed, error: proof.error });
      app.exit(code);
    }
  })
  .catch((error) => {
    console.error(cacheBuildkitFailure(error));
    app.exit(1);
  });
