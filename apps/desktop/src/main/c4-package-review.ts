import type { AppDb } from '@skaro/core';
import type { C4ProposalRecord } from './c4-service';
import type { ProjectContext } from './projects';
import { C4SemanticStore } from './c4-semantic-store';
import { c4SemanticSnapshot } from './c4-semantic-snapshot';
import { taskC4Protocol } from './c4-protocol';
import { requireC4ReviewEvidence } from './c4-review-evidence';

export function classifiedC4Package(db: AppDb, record: C4ProposalRecord) {
  const run = record.scope.runId;
  if (!run) return undefined;
  const job = new C4SemanticStore(db).current(run);
  return job?.state === 'verified' &&
    job.delivered &&
    job.reviewer &&
    job.verdict &&
    job.projectId === record.scope.projectId &&
    job.taskId === record.scope.taskId &&
    job.packageId === record.item.id
    ? job
    : undefined;
}

/** Owner consent cannot upgrade an unclassified or stale worker proposal into a technical sync. */
export async function requireC4PackageReview(
  db: AppDb,
  context: ProjectContext,
  record: C4ProposalRecord,
) {
  const job = classifiedC4Package(db, record);
  if (
    !job ||
    taskC4Protocol(db, context.id, job.runId) !== 'impact-v1' ||
    (await c4SemanticSnapshot(db, context, job.taskId, job.runId, false)).fingerprint !==
      job.fingerprint
  )
    throw new Error('The architecture proposal requires a current independent review');
  await requireC4ReviewEvidence(job);
}
