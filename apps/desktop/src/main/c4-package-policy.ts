import type { AppDb } from '@skaro/core';
import type { C4ProposalRecord } from './c4-service';
import { C4SemanticStore } from './c4-semantic-store';
import { c4RecordProtocol } from './c4-record-protocol';

interface Policy {
  version: 1;
  packageId: string;
  runId: string;
  review: string;
  blocking: boolean;
}
const key = (project: string, id: string) => `c4.coordination.package.${project}.${id}`;
export function saveC4PackagePolicy(
  db: AppDb,
  record: C4ProposalRecord,
  review: string,
  blocking: boolean,
) {
  const job = new C4SemanticStore(db).get(review);
  if (
    c4RecordProtocol(record) !== 'impact-v1' ||
    !job ||
    job.state !== 'verified' ||
    !job.reviewer ||
    job.projectId !== record.scope.projectId ||
    job.runId !== record.scope.runId ||
    job.packageId !== record.item.id ||
    (!blocking &&
      (job.verdict?.category !== 'optional' || job.verdict.implementation !== 'aligned'))
  )
    throw new Error('C4 package classification requires its independent verified review');
  const policy: Policy = {
    version: 1,
    packageId: record.package.id,
    runId: record.scope.runId!,
    review,
    blocking,
  };
  db.setSetting(key(record.scope.projectId, record.item.id), policy);
}
export function c4PackageBlocks(db: AppDb, record: C4ProposalRecord, run: string) {
  if (!['pending', 'accepted'].includes(record.item.state)) return false;
  if (c4RecordProtocol(record) !== 'impact-v1' || record.item.state === 'accepted') return true;
  const policy = db.getSetting<Policy | undefined>(
    key(record.scope.projectId, record.item.id),
    undefined,
    { strict: true },
  );
  const job = policy?.review ? new C4SemanticStore(db).get(policy.review) : undefined;
  return !(
    policy?.version === 1 &&
    policy.packageId === record.package.id &&
    policy.runId === run &&
    policy.blocking === false &&
    job?.state === 'verified' &&
    job.delivered &&
    !!job.reviewer &&
    job.projectId === record.scope.projectId &&
    job.runId === run &&
    job.packageId === record.item.id &&
    job.verdict?.category === 'optional' &&
    job.verdict.implementation === 'aligned'
  );
}
