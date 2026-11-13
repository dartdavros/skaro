import { randomUUID } from 'node:crypto';
import { AppDb, type ResourceLeaseRequest } from '@skaro/core';
import { ApplicationResources } from '../application-resources';
import { ManagedCacheStore } from '../managed-cache-store';
import { removeCacheTree } from '../managed-cache-files';
import { resourceExecution } from '../resource-execution';
import { resourceHolding } from '../resource-holding';
import { cacheVerificationProject } from './cache-verification-scope';
import {
  prepareReconciliationSession,
  recordReconciliationSession,
  validateCacheReconciliationJournal,
  reconciliationRemainder,
  completeJournal,
  type CacheReconciliationJournal,
} from './cache-verification-reconciliation-journal';

import { settleCompletedCacheControls } from './cache-verification-reconciliation-controls';

type Progress = (phase: string) => void;
/** Only known public-downloads residue; this is neither publication nor pressure/LRU acceptance. */
export async function reconcileCacheVerificationFailure(
  db: AppDb,
  resources: ApplicationResources,
  data: string,
  initial: CacheReconciliationJournal,
  progress: Progress = () => undefined,
) {
  if (initial.state === 'complete') {
    await settleCompletedCacheControls(db, data, initial);
    return { journal: initial, alreadyComplete: true };
  }
  const project = await cacheVerificationProject(db),
    store = new ManagedCacheStore(db, data);
  let journal = initial;
  return store.serial(() =>
    resources.scope(
      project.projectId,
      'managed-cache:reconciliation',
      async () => {
        const scope = resourceExecution.getStore()!;
        const request: ResourceLeaseRequest = {
          id: randomUUID(),
          projectId: project.projectId,
          ownerId: scope.ownerId,
          intentId: scope.intentId,
          checkpoint: 'cache-reconciliation',
          locks: [
            {
              resourceId: journal.original.sourceResource.id,
              generation: journal.original.sourceResource.generation,
              mode: 'shared',
            },
          ],
          cost: {
            ramBytes: 128 * 1024 ** 2,
            cpuMillis: 500,
            model: 0,
            environment: 0,
            build: 0,
            review: 0,
            diskBytes: {},
          },
        };
        progress('record-controller-request');
        journal = await prepareReconciliationSession(db, journal, request);
        // Normal admission/fairness, not an adopted or revived old grant. Persisted request closes crash gaps.
        const lease = await resources.manager.acquire(request, { ...scope, wait: false });
        const held = resourceHolding(db, resources.manager, lease);
        let settled = false;
        try {
          await scope.requireCurrent();
          journal = await recordReconciliationSession(db, journal, held.lease);
          const verify = async () => {
            await scope.requireCurrent();
            await validateCacheReconciliationJournal(db, data, journal, held.lease.id);
          };
          await verify();
          async function remove(role: 'artifact' | 'scratch' | 'stage', resourceId: string) {
            const remaining = await reconciliationRemainder(journal, role);
            if (remaining)
              await removeCacheTree(
                store.root,
                journal.trees[role].path,
                remaining.digest,
                () => {
                  scope.signal.throwIfAborted();
                  db.resources.cleanup.effect(resourceId);
                },
                remaining,
              );
            if (await reconciliationRemainder(journal, role))
              throw new Error('cache_reconciliation_tree_still_present');
          }
          async function clean(resourceId: string, operation: string, stage: boolean) {
            const resource = db.resources.get(resourceId)!;
            const fence = db.resources.cleanup.read(resourceId);
            if (resource.state === 'released' && !fence) return;
            const original = db.admission.get(
              project.projectId,
              journal.original.dependenciesLease.id,
            )!;
            await db.resources.cleanup.runCacheReconciliation(
              resource,
              operation,
              {
                controller: held.lease,
                fence,
                consumers: resource.consumers,
                retained: stage && original.state === 'retained' ? [original] : [],
                verifyClosed: verify,
              },
              async () => {
                progress(stage ? 'remove-verified-input' : 'remove-verified-cache-and-scratch');
                if (stage) await remove('stage', resourceId);
                else {
                  await remove('scratch', resourceId);
                  await remove('artifact', resourceId);
                }
                await verify();
                const current = db.resources.get(resourceId)!;
                db.resources.update(resourceId, current.revision, {
                  state: 'released',
                  consumers: [],
                });
              },
            );
          }
          await clean(
            journal.original.resource.id,
            `cache.reconcile:${journal.original.resource.id}:${journal.original.resource.generation}`,
            false,
          );
          await clean(
            journal.original.stageResource.id,
            journal.original.stageFence.operationId,
            true,
          );
          await verify();
          progress('release-physically-settled-reservations');
          const ids = [journal.original.dependenciesLease.id, journal.original.sourceLease.id];
          for (const id of ids) {
            await verify();
            const old = db.admission.get(project.projectId, id);
            if (!old || old.state === 'released') continue;
            if (old.state !== 'retained')
              throw new Error('cache_reconciliation_old_reservation_not_retained');
            const generations = Object.fromEntries(
              old.locks.map((lock) => {
                const actual = db.resources.get(lock.resourceId);
                if (!actual || actual.generation !== lock.generation)
                  throw new Error('cache_reconciliation_generation_changed');
                return [lock.resourceId, lock.generation];
              }),
            );
            db.admission.release(
              project.projectId,
              old.id,
              old.revision,
              generations,
              'known_public_downloads_and_supervised_version_executor_reconciled',
            );
          }
          await verify();
          const entry = journal.original.entry;
          store.outcome(
            entry,
            'released',
            'managed_pnpm_incomplete_public_downloads_reconciled',
            journal.trees.artifact.bytes,
          );
          store.forget(entry.key);
          journal = await completeJournal(db, journal);
          await settleCompletedCacheControls(db, data, journal, held.lease.id);
          settled = true;
          progress('reconciliation-complete');
          return {
            journal,
            alreadyComplete: false,
            logicalBytesRemoved:
              journal.trees.artifact.bytes +
              journal.trees.stage.bytes +
              journal.trees.scratch.bytes,
          };
        } finally {
          if (settled)
            held.release('cache_reconciliation_local_effects_and_all_reservations_settled');
          else {
            const current = db.admission.get(project.projectId, held.lease.id);
            if (current?.state === 'granted')
              db.admission.retain(project.projectId, current.id, current.revision);
          }
        }
      },
      { requireCurrent: () => project.requireCurrent() },
    ),
  );
}
