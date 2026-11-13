import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { AppDb } from '@skaro/core';
import { ApplicationResources } from '../application-resources';
import { ManagedCacheStore } from '../managed-cache-store';
import { resourceExecution } from '../resource-execution';
import { resourceHolding } from '../resource-holding';
import {
  createVerifiedArchive,
  reopenVerifiedArchive,
  archiveReceipt,
  type VerifiedArchive,
} from '../managed-verification-archive-store';
import { removeArchivedSources } from '../managed-verification-archive-remove';
import { cacheVerificationProject } from './cache-verification-scope';
import { SIXTH_ARCHIVE as a } from './cache-archive-sixth-identity';
import { saveSixthArchiveJournal, type SixthArchiveJournal } from './cache-archive-sixth-journal';
import { sixthControllerRequest } from './cache-archive-sixth-authority';
import { requireArchiveAllocation } from './cache-archive-allocation';

import { inspectSixthArchiveState as verifyArchiveState } from './cache-archive-sixth-inspection';
async function settleControls(db: AppDb, data: string, j: SixthArchiveJournal, currentId?: string) {
  assert.equal(j.state, 'complete');
  await verifyArchiveState(db, data, j, undefined, currentId);
  for (const p of j.preparations) {
    if (p.request.id === currentId) continue;
    const lease = db.admission.get(j.project.projectId, p.request.id);
    if (!lease || ['released', 'cancelled', 'stopped_by_owner'].includes(lease.state)) continue;
    if (['waiting_resource', 'waiting_quota'].includes(lease.state)) {
      db.admission.cancel(
        j.project.projectId,
        lease.id,
        lease.revision,
        'archive_complete_ungranted_control_cancelled',
      );
    } else {
      const generations = Object.fromEntries(
        lease.locks.map((lock) => [lock.resourceId, lock.generation]),
      );
      db.admission.release(
        j.project.projectId,
        lease.id,
        lease.revision,
        generations,
        'archive_copy_verified_originals_absent_and_controller_closed',
      );
    }
  }
}
export async function runSixthArchiveRecovery(
  db: AppDb,
  resources: ApplicationResources,
  data: string,
  initial: SixthArchiveJournal,
  runId: string,
  progress: (phase: string) => void = () => undefined,
) {
  let j = initial;
  if (j.state === 'complete') {
    await settleControls(db, data, j);
    return { alreadyComplete: true, backup: j.backup, snapshotDigest: j.snapshotDigest };
  }
  const project = await cacheVerificationProject(db),
    store = new ManagedCacheStore(db, data);
  return store.serial(() =>
    resources.scope(
      project.projectId,
      'managed-cache:reconciliation',
      async () => {
        const scope = resourceExecution.getStore()!;
        await verifyArchiveState(db, data, j);
        requireArchiveAllocation(db, j.allocation, a.diskBytes);
        const request = sixthControllerRequest(randomUUID(), scope.intentId, j.diskDevice);
        const birth = await processBirth(process.pid);
        assert(birth);
        j = {
          ...j,
          preparations: [...j.preparations, { request, pid: process.pid, birth, at: Date.now() }],
        };
        saveSixthArchiveJournal(db, data, j);
        progress('acquire-fresh-archive-controller');
        let lease;
        try {
          lease = await resources.manager.acquire(request, { ...scope, wait: false });
        } catch (error) {
          const waiting = db.admission.get(project.projectId, request.id);
          if (waiting && ['waiting_resource', 'waiting_quota'].includes(waiting.state))
            db.admission.cancel(
              project.projectId,
              waiting.id,
              waiting.revision,
              'archive_admission_unavailable_before_effects',
            );
          throw error;
        }
        const held = resourceHolding(db, resources.manager, lease);
        let completed = false,
          verified: VerifiedArchive | undefined;
        try {
          j = { ...j, sessions: [...j.sessions, { lease: held.lease, pid: process.pid, birth }] };
          saveSixthArchiveJournal(db, data, j);
          const verify = async () => {
            await scope.requireCurrent();
            await verifyArchiveState(db, data, j, verified, held.lease.id);
          };
          await verify();
          async function clean(stage: boolean) {
            const id = stage ? j.original.stageResource.id : j.original.resource.id;
            const current = db.resources.get(id)!;
            const fence = db.resources.cleanup.read(id);
            if (current.state === 'released' && !fence) return;
            const original = db.admission.get(project.projectId, a.dependencyLeaseId)!;
            await db.resources.cleanup.runCacheReconciliation(
              current,
              stage ? j.original.stageFence.operationId : `cache.archive:${id}:1`,
              {
                controller: held.lease,
                fence,
                consumers: current.consumers,
                retained: stage && original.state === 'retained' ? [original] : [],
                verifyClosed: verify,
              },
              async () => {
                const effect = () => {
                  scope.signal.throwIfAborted();
                  requireArchiveAllocation(db, j.allocation, a.diskBytes);
                  db.resources.cleanup.effect(id);
                };
                if (j.backup && !verified)
                  verified = await reopenVerifiedArchive({
                    database: db,
                    expectedArchiveId: j.archiveId,
                    expectedProjectId: j.project.projectId,
                    expectedSubjectIntent: a.intent,
                    expectedDatabaseIdentity: j.databaseIdentity,
                    expectedManifestDigest: j.backup.manifestDigest,
                    expectedRoots: j.roots,
                    hostGate: effect,
                    durability: 'delete-ready',
                  });
                if (!j.backup) {
                  assert(!stage);
                  progress('preserve-full-original-bytes-and-link-metadata');
                  verified = await createVerifiedArchive({
                    snapshot: j.snapshot,
                    database: db,
                    archiveId: j.archiveId,
                    projectId: j.project.projectId,
                    subjectIntent: a.intent,
                    hostGate: effect,
                  });
                  j = { ...j, backup: archiveReceipt(verified), state: 'archived' };
                  saveSixthArchiveJournal(db, data, j);
                }
                assert(verified && j.backup);
                progress(stage ? 'remove-archived-input' : 'remove-archived-probe-and-cas');
                await removeArchivedSources(verified, {
                  roles: stage ? ['stage'] : ['scratch', 'artifact'],
                  effectGate: () => effect(),
                });
                await verify();
                const actual = db.resources.get(id)!;
                db.resources.update(id, actual.revision, { state: 'released', consumers: [] });
              },
            );
          }
          await clean(false);
          await clean(true);
          await verify();
          progress('release-physically-settled-original-reservations');
          for (const id of [a.dependencyLeaseId, a.sourceLeaseId]) {
            await verify();
            const original = db.admission.get(project.projectId, id)!;
            if (original.state === 'released') continue;
            assert.equal(original.state, 'retained');
            const generations = Object.fromEntries(
              original.locks.map((lock) => {
                assert.equal(db.resources.get(lock.resourceId)?.generation, lock.generation);
                return [lock.resourceId, lock.generation];
              }),
            );
            db.admission.release(
              project.projectId,
              id,
              original.revision,
              generations,
              'owner_archive_verified_before_exact_original_cleanup',
            );
          }
          await verify();
          if (store.artifacts().some((e) => e.key === a.key)) {
            store.outcome(
              j.original.entry,
              'released',
              'managed_pnpm_partial_preserved_in_verified_owner_archive',
              Number(j.snapshot.totalBytes),
            );
            store.forget(a.key);
          }
          j = { ...j, state: 'complete' };
          saveSixthArchiveJournal(db, data, j);
          await settleControls(db, data, j, held.lease.id);
          completed = true;
          progress('archive-reconciliation-complete');
          return {
            alreadyComplete: false,
            backup: j.backup,
            snapshotDigest: j.snapshotDigest,
            logicalOriginalBytesRemoved: j.snapshot.totalBytes,
          };
        } finally {
          if (completed) held.release('owner_archive_complete_and_original_effects_settled');
          else {
            const current = db.admission.get(project.projectId, held.lease.id);
            if (current?.state === 'granted')
              db.admission.retain(project.projectId, current.id, current.revision);
          }
        }
      },
      { intentId: runId, requireCurrent: () => project.requireCurrent() },
    ),
  );
}
export { verifyArchiveState as inspectSixthArchiveState };
