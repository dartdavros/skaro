import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AppDb } from '@skaro/core';
import type { ApplicationResources } from '../application-resources';
import { ManagedCacheStore } from '../managed-cache-store';
import { resourceExecution } from '../resource-execution';
import { resourceHolding } from '../resource-holding';
import {
  cacheReconciliationControlCost,
  settleClosedCacheControls,
} from './cache-reconciliation-controls';
import { protectedFingerprint } from './reclamation-observation';
import { resourceInventory } from './resource-workflow-observation';
import { existingBuildkitObjects } from './cache-buildkit-preservation';
import { cacheVerificationProject } from './cache-verification-scope';
import {
  INITIALIZATION_KEY,
  INITIALIZATION_INTENT,
  initializationProof,
  initializationEntry,
  emptyInitializationLayout,
  requireOriginalInitializationLeases,
  sameInitializationLease,
  type InitializationJournal,
} from './cache-buildkit-initialization';

/** Only reconciles unused reservations. No path deletion, Docker effects, ready-state or generation change. */
export async function reconcileBuildkitInitialization(
  db: AppDb,
  resources: ApplicationResources,
  data: string,
  intentId: string,
) {
  const proof = await initializationProof(data),
    project = await cacheVerificationProject(db);
  const store = new ManagedCacheStore(db, data);
  let journal = db.getSetting<InitializationJournal | undefined>(INITIALIZATION_KEY, undefined);
  if (!journal) {
    requireOriginalInitializationLeases(proof.finalLeases);
    journal = {
      proofHash: '028d3475a6550095e6cbc6d8faaebdf119ddf5fa927c59608b022bb03894a719',
      entry: initializationEntry(store),
      layout: await emptyInitializationLayout(store),
      originals: proof.finalLeases,
      controls: [],
      complete: false,
    };
  }
  const j = journal;
  assert.equal(j.proofHash, '028d3475a6550095e6cbc6d8faaebdf119ddf5fa927c59608b022bb03894a719');
  assert.deepEqual(j.originals, proof.finalLeases);
  const verify = async () => {
    await project.requireCurrent();
    await initializationProof(data);
    assert.deepEqual(initializationEntry(store), j.entry);
    assert.deepEqual(await emptyInitializationLayout(store), j.layout);
    assert.deepEqual(
      await protectedFingerprint(db, project.projectId, project.root, data, []),
      proof.protectedAfter,
    );
    const inventory = await resourceInventory(project.root, j.entry.client);
    assert.deepEqual(inventory, proof.foreignAfter);
    assert.deepEqual(
      await existingBuildkitObjects(project.root, inventory, j.entry.client),
      proof.objectsAfter,
    );
    for (const original of j.originals)
      sameInitializationLease(db.admission.get(project.projectId, original.id)!, original);
    const source = db.resources.get(j.originals[0]!.locks[0]!.resourceId)!;
    assert.equal(source.state, 'available');
    assert.equal(source.generation, 1);
    assert.equal(db.resources.cleanup.read(source.id), undefined);
    const readers = db.admission
      .all()
      .filter(
        (lease) =>
          ['granted', 'retained'].includes(lease.state) &&
          lease.locks.some((lock) => lock.resourceId === source.id),
      );
    assert.deepEqual(
      source.consumers.map((consumer) => consumer.id).sort(),
      readers.map((lease) => `lease:${lease.id}`).sort(),
    );
    const allowed = new Set([...j.controls, ...j.originals.map((lease) => lease.id)]);
    assert(
      !db.admission
        .all()
        .some(
          (lease) =>
            lease.projectId === project.projectId &&
            !['released', 'cancelled', 'stopped_by_owner'].includes(lease.state) &&
            !allowed.has(lease.id),
        ),
    );
  };
  await verify();
  const save = () => db.setSetting(INITIALIZATION_KEY, j);
  const closeControls = (current?: string) =>
    settleClosedCacheControls(
      db,
      {
        projectId: project.projectId,
        intentId: INITIALIZATION_INTENT,
        ids: j.controls,
        locks: j.originals[0]!.locks,
      },
      current,
    );
  if (j.complete) {
    assert(
      j.originals.every(
        (lease) => db.admission.get(project.projectId, lease.id)?.state === 'released',
      ),
    );
    closeControls();
    return { alreadyComplete: true };
  }
  return resources.scope(
    project.projectId,
    'managed-cache:reconciliation',
    async () => {
      const id = randomUUID();
      j.controls.push(id);
      save();
      const lease = await resources.manager.acquire(
        {
          id,
          projectId: project.projectId,
          ownerId: 'managed-cache:reconciliation',
          intentId: INITIALIZATION_INTENT,
          checkpoint: 'cache-reconciliation',
          locks: j.originals[0]!.locks,
          cost: cacheReconciliationControlCost(),
        },
        { ...resourceExecution.getStore()!, wait: false },
      );
      const held = resourceHolding(db, resources.manager, lease);
      let complete = false;
      try {
        await verify();
        assert(held.isLive?.());
        for (const original of j.originals) {
          await verify();
          const current = db.admission.get(project.projectId, original.id)!;
          if (current.state === 'released') continue;
          db.admission.release(
            project.projectId,
            current.id,
            current.revision,
            Object.fromEntries(current.locks.map((lock) => [lock.resourceId, lock.generation])),
            'buildkit_initialization_no_dispatch_native_and_docker_proven',
          );
        }
        await verify();
        j.complete = true;
        save();
        closeControls(id);
        complete = true;
        return { alreadyComplete: false, originals: j.originals.map((item) => item.id), intentId };
      } finally {
        if (complete) held.release('unused_initialization_reconciliation_complete');
        else {
          const current = db.admission.get(project.projectId, id)!;
          if (current.state === 'granted')
            db.admission.retain(project.projectId, id, current.revision);
        }
      }
    },
    { intentId: INITIALIZATION_INTENT, requireCurrent: () => project.requireCurrent() },
  );
}
