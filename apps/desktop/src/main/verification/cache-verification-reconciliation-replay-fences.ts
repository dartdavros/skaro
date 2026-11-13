import type { AppDb } from '@skaro/core';
import { withReplayReader } from './cache-verification-reconciliation-replay-storage';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { reconciliationAttempt } from './cache-verification-reconciliation-identity';
import { replayEqual } from './cache-verification-reconciliation-replay-lease';
import {
  replayFail as fail,
  type CacheReconciliationJournal,
} from './cache-verification-reconciliation-replay-types';

const prefix = 'resource.cleanup.fence.';
const contains = (parent: string, child: string) => {
  const path = relative(resolve(parent), resolve(child));
  return !path || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
};

/** Enumerate ALL durable fences, including orphans; blocking() alone only exposes the first match. */
export function readReplayFences(db: AppDb, journal: CacheReconciliationJournal) {
  const attempt = reconciliationAttempt(journal.original);
  const rows = withReplayReader(db, (reader) => {
    const size = reader
      .prepare(
        `SELECT count(*) AS nodes, coalesce(sum(length(CAST(value AS BLOB))),0)
      AS bytes FROM settings WHERE key LIKE ?`,
      )
      .get(`${prefix}%`)!;
    if (Number(size.nodes) > 10000 || Number(size.bytes) > 8 * 1024 ** 2) fail('fence_limit');
    return reader
      .prepare('SELECT key,value FROM settings WHERE key LIKE ? ORDER BY key')
      .all(`${prefix}%`)
      .map((row) => ({ key: String(row.key), value: String(row.value) }));
  });
  const fences = [];
  const relevantPaths = [
    journal.project.root,
    ...Object.values(journal.trees).map((tree) => tree.path),
  ];
  for (const row of rows) {
    if (Buffer.byteLength(row.value) > 64 * 1024) fail('fence_size');
    const id = row.key.slice(prefix.length),
      fence = db.resources.cleanup.read(id);
    if (!fence) fail('fence_changed');
    replayEqual(fence, JSON.parse(row.value), 'fence_changed');
    if (id === attempt.sourceId) fail('unexpected_source_fence');
    const known = id === attempt.artifactId || id === attempt.stageId;
    if (
      !known &&
      (!fence!.identity.path ||
        !relevantPaths.some(
          (path) => contains(path, fence!.identity.path!) || contains(fence!.identity.path!, path),
        ))
    )
      continue;
    if (!known) fail('unknown_overlapping_fence');
    fences.push(fence!);
  }
  const artifact = fences.find((fence) => fence.resourceId === attempt.artifactId),
    stage = fences.find((fence) => fence.resourceId === attempt.stageId);
  for (const fence of fences) {
    const isStage = fence.resourceId === attempt.stageId,
      resource = isStage ? journal.original.stageResource : journal.original.resource;
    replayEqual(fence.identity, resource.identity, 'fence_identity');
    replayEqual(fence.objectIds, [], 'fence_objects');
    replayEqual(
      fence.signature,
      JSON.stringify([
        resource.projectId,
        resource.kind,
        resource.identity,
        resource.owner,
        resource.purpose,
        resource.ownership,
        resource.preservation,
        resource.source,
      ]),
      'fence_signature',
    );
    if (
      fence.generation !== resource.generation ||
      fence.operationId !==
        (isStage
          ? `cache.input:${attempt.stageId}:${attempt.stageGeneration}`
          : `cache.reconcile:${attempt.artifactId}:${attempt.artifactGeneration}`) ||
      fence.mode !== (isStage ? 'maintenance' : 'remove') ||
      fence.authorityLeaseId !== (isStage ? attempt.dependenciesLeaseId : undefined)
    )
      fail('fence_binding');
    if (isStage && isDeepStrictEqual(fence, journal.original.stageFence)) continue;
    if (fence.externalPending || !journal.sessions.some((session) => session.pid === fence.pid))
      fail('fence_not_recorded_local_session');
  }
  return { artifact, stage, rows };
}
