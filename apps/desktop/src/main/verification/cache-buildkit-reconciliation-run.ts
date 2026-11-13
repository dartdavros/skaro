import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AppDb } from '@skaro/core';
import type { ApplicationResources } from '../application-resources';
import { ManagedCacheStore } from '../managed-cache-store';
import { resourceHolding } from '../resource-holding';
import { resourceExecution } from '../resource-execution';
import {
  cacheReconciliationControlCost,
  settleClosedCacheControls,
} from './cache-reconciliation-controls';
import { cacheVerificationProject } from './cache-verification-scope';
import { protectedFingerprint } from './reclamation-observation';
import { resourceInventory } from './resource-workflow-observation';
import { existingBuildkitObjects } from './cache-buildkit-preservation';
import { sameInitializationLease } from './cache-buildkit-initialization';
import type { CreatedJournal } from './cache-buildkit-created-journal';
import {
  createdBuildkitCase,
  type BuildkitReconciliationCase,
} from './cache-buildkit-reconciliation-case';

/** Reconcile a real never-started builder without touching its files, volume, image or container. */
export async function reconcileInactiveBuildkit(
  db: AppDb,
  resources: ApplicationResources,
  data: string,
  contract: BuildkitReconciliationCase = createdBuildkitCase,
) {
  const project = await cacheVerificationProject(db),
    store = new ManagedCacheStore(db, data);
  const failed = await contract.failedProof(data, db);
  let j = db.getSetting<CreatedJournal | undefined>(contract.key, undefined);
  if (!j) {
    const observed = await contract.inspect(store),
      inventory = await resourceInventory(project.root, observed.entry.client);
    const resource = store.current(observed.entry),
      fence = db.resources.cleanup.read(resource.id);
    assert(fence && !fence.externalPending && fence.mode === 'maintenance');
    for (const original of failed.finalLeases)
      assert.deepEqual(db.admission.get(project.projectId, original.id), original);
    j = {
      observed,
      inventory,
      objects: await existingBuildkitObjects(project.root, inventory, observed.entry.client),
      resource,
      fence,
      originals: failed.finalLeases,
      controls: [],
      complete: false,
    };
  }
  const journal = j;
  assert.deepEqual(journal.originals, failed.finalLeases);
  const sourceLock = journal.originals.find(
    (lease) => lease.ownerId === 'cache-verification:source',
  )!.locks;
  const builderLease = journal.originals.find(
    (lease) => lease.ownerId === 'managed-cache:buildkit',
  )!;
  const cost = cacheReconciliationControlCost();
  const verify = async () => {
    await project.requireCurrent();
    await contract.failedProof(data, db);
    assert.deepEqual(await contract.inspect(store), journal.observed);
    assert.deepEqual(
      await protectedFingerprint(db, project.projectId, project.root, data, []),
      failed.protectedBefore,
    );
    const inventory = await resourceInventory(project.root, journal.observed.entry.client);
    assert.deepEqual(inventory, journal.inventory);
    assert.deepEqual(
      await existingBuildkitObjects(project.root, inventory, journal.observed.entry.client),
      journal.objects,
    );
    for (const original of journal.originals)
      sameInitializationLease(
        db.admission.get(project.projectId, original.id)!,
        original,
        contract.evidence,
      );
    const current = store.current(journal.observed.entry);
    const immutable = ({ revision, updatedAt, consumers, ...rest }: typeof current) => {
      void revision;
      void updatedAt;
      void consumers;
      return rest;
    };
    assert.deepEqual(immutable(current), immutable(journal.resource));
    const held = db.admission.get(project.projectId, builderLease.id)!;
    assert.deepEqual(
      current.consumers,
      held.state === 'retained' ? journal.resource.consumers : [],
    );
    const allowed = new Set([...journal.controls, ...journal.originals.map((lease) => lease.id)]);
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
    const source = db.resources.get(sourceLock[0]!.resourceId)!;
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
      source.consumers.map((reader) => reader.id).sort(),
      readers.map((lease) => `lease:${lease.id}`).sort(),
    );
  };
  await verify();
  const save = () => db.setSetting(contract.key, journal);
  const closeControls = (current?: string) =>
    settleClosedCacheControls(
      db,
      {
        projectId: project.projectId,
        intentId: contract.intentId,
        ids: journal.controls,
        locks: sourceLock,
      },
      current,
    );
  if (journal.complete) {
    assert.equal(db.resources.cleanup.read(journal.resource.id), undefined);
    assert(
      journal.originals.every(
        (lease) => db.admission.get(project.projectId, lease.id)?.state === 'released',
      ),
    );
    closeControls();
    return { alreadyComplete: true };
  }
  return store.serial(() =>
    resources.scope(
      project.projectId,
      'managed-cache:reconciliation',
      async () => {
        const id = randomUUID();
        journal.controls.push(id);
        save();
        const lease = await resources.manager.acquire(
          {
            id,
            projectId: project.projectId,
            ownerId: 'managed-cache:reconciliation',
            checkpoint: 'cache-reconciliation',
            intentId: contract.intentId,
            locks: sourceLock,
            cost,
          },
          { ...resourceExecution.getStore()!, wait: false },
        );
        const controller = resourceHolding(db, resources.manager, lease);
        let complete = false;
        try {
          await verify();
          const current = store.current(journal.observed.entry),
            fence = db.resources.cleanup.read(current.id);
          if (fence) {
            assert.equal(db.admission.get(project.projectId, builderLease.id)?.state, 'retained');
            assert.equal(fence.authorityLeaseId, builderLease.id);
            const reconcile = (
              contract.kind === 'created'
                ? db.resources.cleanup.runUnstartedBuildkitReconciliation
                : db.resources.cleanup.runStoppedBuildkitReconciliation
            ).bind(db.resources.cleanup);
            await reconcile(
              current,
              journal.fence.operationId,
              {
                controller: controller.lease,
                fence,
                consumers: current.consumers,
                retained: [db.admission.get(project.projectId, builderLease.id)!],
                verifyClosed: verify,
              },
              async () => {
                await verify();
                db.resources.cleanup.reconciled(current.id);
              },
            );
          }
          for (const original of journal.originals) {
            await verify();
            assert.equal(db.resources.cleanup.read(current.id), undefined);
            const held = db.admission.get(project.projectId, original.id)!;
            if (held.state === 'released') continue;
            db.admission.release(
              project.projectId,
              held.id,
              held.revision,
              Object.fromEntries(held.locks.map((lock) => [lock.resourceId, lock.generation])),
              contract.evidence,
            );
          }
          await verify();
          journal.complete = true;
          save();
          closeControls(id);
          complete = true;
          return {
            alreadyComplete: false,
            resourceId: current.id,
            generation: current.generation,
            volumeDigest: journal.observed.volumeDigest,
            policy: 'no-start-no-delete-no-ready-state',
          };
        } finally {
          if (complete)
            controller.release('created_builder_domain_verified_and_retained_capacity_settled');
          else {
            const held = db.admission.get(project.projectId, id)!;
            if (held.state === 'granted') db.admission.retain(project.projectId, id, held.revision);
          }
        }
      },
      { intentId: contract.intentId, requireCurrent: () => project.requireCurrent() },
    ),
  );
}
