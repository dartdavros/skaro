import assert from 'node:assert/strict';
import type { AppDb, ResourceLeaseRequest } from '@skaro/core';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import { ManagedCacheStore } from '../managed-cache-store';
import { cacheProcessAbsent } from '../managed-cache-metadata';
import {
  preservedReconciliationDatabase,
  verifyPreservedReconciliationProofs,
} from './cache-verification-reconciliation-preserved';
import { replayLeaseRequest } from './cache-verification-reconciliation-replay-lease';
import {
  SIXTH_ARCHIVE as a,
  SIXTH_ARCHIVE_KEY,
  archiveEqual,
  immutableArchiveLease,
  immutableArchiveResource,
} from './cache-archive-sixth-identity';
import { requireSixthSource } from './cache-archive-sixth-plan';
import { assertSixthArchiveJournal, type SixthArchiveJournal } from './cache-archive-sixth-journal';

export const sixthControllerRequest = (
  id: string,
  intentId: string,
  diskDevice: string,
): ResourceLeaseRequest => ({
  id,
  projectId: 'b1a0a1fc-5435-4b37-a30a-c2b3d6c06f1b',
  ownerId: 'managed-cache:reconciliation',
  intentId,
  checkpoint: 'cache-reconciliation',
  locks: [{ resourceId: a.sourceId, generation: 1, mode: 'shared' }],
  cost: {
    ramBytes: 512 * 1024 ** 2,
    cpuMillis: 500,
    model: 0,
    environment: 0,
    build: 0,
    review: 0,
    diskBytes: { [diskDevice]: a.diskBytes },
  },
});
export interface ArchiveAbsence {
  artifact: boolean;
  scratch: boolean;
  stage: boolean;
}
/** Metadata never supplies a grant. Current live lease + native closure + archive observations are mandatory. */
export async function assertSixthDomain(
  db: AppDb,
  data: string,
  j: SixthArchiveJournal,
  absent: ArchiveAbsence,
  controllerId?: string,
) {
  assertSixthArchiveJournal(j, data);
  await requireSixthSource(db, j.original);
  const project = j.project.projectId,
    store = new ManagedCacheStore(db, data);
  const preparations = j.preparations.map((p) => p.request.id);
  archiveEqual(
    preservedReconciliationDatabase(
      db,
      store.artifacts(),
      j.original,
      preparations,
      SIXTH_ARCHIVE_KEY,
    ),
    Object.fromEntries(Object.entries(j.preserved).filter(([k]) => k !== 'proofs')),
    'preserved_database_changed',
  );
  await verifyPreservedReconciliationProofs(data, j.preserved.proofs);
  const artifact = db.resources.get(j.original.resource.id)!,
    stage = db.resources.get(j.original.stageResource.id)!,
    source = db.resources.get(a.sourceId)!;
  assert(artifact && stage && source);
  for (const [current, original] of [
    [artifact, j.original.resource],
    [stage, j.original.stageResource],
    [source, j.original.sourceResource],
  ] as const) {
    archiveEqual(
      immutableArchiveResource(current),
      immutableArchiveResource(original),
      'resource_binding',
    );
    assert(current.revision >= original.revision && current.updatedAt >= original.updatedAt);
  }
  const cacheGone = absent.artifact && absent.scratch;
  const artifactFence = db.resources.cleanup.read(artifact.id),
    stageFence = db.resources.cleanup.read(stage.id);
  for (const [resource, original, gone] of [
    [artifact, j.original.resource, cacheGone],
    [stage, j.original.stageResource, absent.stage],
  ] as const) {
    assert(['available', 'released'].includes(resource.state));
    if (resource.state === 'released') {
      assert(gone);
      archiveEqual(resource.consumers, [], 'released_consumers');
    } else archiveEqual(resource.consumers, original.consumers, 'original_consumers');
  }
  assert.equal(source.state, 'available');
  const settled =
    cacheGone &&
    absent.stage &&
    artifact.state === 'released' &&
    stage.state === 'released' &&
    !artifactFence &&
    !stageFence;
  if (!stageFence && !absent.stage) throw new Error('cache_archive_stage_fence_lost');
  for (const fence of [artifactFence, stageFence]) {
    if (!fence) continue;
    if (fence.pid === a.pid) archiveEqual(fence, j.original.stageFence, 'foreign_fence');
    else {
      const recorded = j.sessions.find((s) => s.pid === fence.pid);
      assert(recorded);
      assert.equal(fence.externalPending, false);
      assert.equal(fence.generation, 1);
      if (fence.resourceId === stage.id) {
        assert.equal(fence.mode, j.original.stageFence.mode);
        assert.equal(fence.authorityLeaseId, a.dependencyLeaseId);
        assert.equal(fence.signature, j.original.stageFence.signature);
        assert.equal(fence.operationId, j.original.stageFence.operationId);
      } else {
        assert.equal(fence.resourceId, artifact.id);
        assert.equal(fence.mode, 'remove');
        assert.equal(fence.authorityLeaseId, undefined);
        assert.equal(fence.operationId, `cache.archive:${artifact.id}:1`);
      }
    }
  }
  const knownIds = new Set([a.sourceLeaseId, a.dependencyLeaseId, ...preparations]);
  const relevant = db.admission
    .all()
    .filter(
      (l) =>
        l.projectId === project ||
        l.locks.some((lock) => [artifact.id, stage.id, source.id].includes(lock.resourceId)),
    );
  assert(relevant.length <= 10000);
  for (const lease of relevant)
    if (!knownIds.has(lease.id)) {
      assert(
        ['released', 'cancelled', 'stopped_by_owner'].includes(lease.state) &&
          lease.createdAt < j.createdAt,
      );
    }
  for (const original of [j.original.sourceLease, j.original.dependenciesLease]) {
    const current = db.admission.get(project, original.id)!;
    assert(current);
    if (current.state === 'retained')
      archiveEqual(current, original, 'retained_reservation_changed');
    else {
      assert(settled && current.state === 'released' && current.revision > original.revision);
      archiveEqual(
        immutableArchiveLease(current),
        immutableArchiveLease(original),
        'released_reservation_changed',
      );
    }
  }
  const allSources = [
    j.original.sourceLease.id,
    j.original.dependenciesLease.id,
    ...preparations,
  ].flatMap((id) => {
    const lease = db.admission.get(project, id);
    return lease && ['granted', 'retained'].includes(lease.state) ? [lease] : [];
  });
  archiveEqual(
    source.consumers,
    allSources
      .map((l) => ({ id: `lease:${l.id}`, generation: 1, kind: 'unknown' }))
      .sort((x, y) => x.id.localeCompare(y.id)),
    'source_consumers',
  );
  for (const p of j.preparations) {
    archiveEqual(
      p.request,
      sixthControllerRequest(p.request.id, p.request.intentId, j.diskDevice),
      'control_request',
    );
    const lease = db.admission.get(project, p.request.id),
      session = j.sessions.find((s) => s.lease.id === p.request.id);
    if (lease) {
      archiveEqual(replayLeaseRequest(lease), p.request, 'control_lease_request');
      assert(lease.createdAt >= p.at);
      if (session) {
        archiveEqual(
          immutableArchiveLease(lease),
          immutableArchiveLease(session.lease),
          'control_binding',
        );
        assert(
          lease.revision >= session.lease.revision &&
            ['granted', 'retained', 'released'].includes(lease.state),
        );
        if (lease.state === 'released') assert(settled);
      } else
        assert(
          ['waiting_resource', 'waiting_quota', 'cancelled', 'stopped_by_owner'].includes(
            lease.state,
          ),
        );
    }
    if (p.request.id === controllerId) {
      assert(
        session &&
          lease?.state === 'granted' &&
          p.pid === process.pid &&
          (await processBirth(p.pid)) === p.birth,
      );
      archiveEqual(lease, session.lease, 'fresh_controller_changed');
    } else {
      assert(cacheProcessAbsent(p.pid) && (await processBirth(p.pid)) === undefined);
    }
  }
  if (controllerId) assert(j.sessions.some((s) => s.lease.id === controllerId));
  const entries = store.artifacts().filter((e) => e.key === a.key);
  if (entries.length) archiveEqual(entries, [j.original.entry], 'entry_changed');
  else
    assert(
      settled &&
        [a.sourceLeaseId, a.dependencyLeaseId].every(
          (id) => db.admission.get(project, id)?.state === 'released',
        ),
    );
  assert(
    db.resources
      .outcomes(artifact.id, 1000)
      .some((o) =>
        j.original.outcomes.some((before) => JSON.stringify(o) === JSON.stringify(before)),
      ),
    'Original producer receipt lost',
  );
  if (j.state === 'complete') assert(settled && !entries.length);
  return {
    settled,
    originalsReleased: [a.sourceLeaseId, a.dependencyLeaseId].every(
      (id) => db.admission.get(project, id)?.state === 'released',
    ),
    metadataAbsent: !entries.length,
  };
}
