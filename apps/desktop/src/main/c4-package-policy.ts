import type { AppDb } from '@skaro/core';
import type { C4ProposalRecord } from './c4-service';
import { C4SemanticStore } from './c4-semantic-store';
import { c4RecordProtocol } from './c4-record-protocol';
import { taskC4Protocol } from './c4-protocol';
import { c4ReviewedImplementationAligned } from './c4-semantic-result';

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
    (!blocking && !c4ReviewedImplementationAligned(job.verdict))
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
  if (record.item.state === 'accepted') return true;
  if (c4RecordProtocol(record) !== 'impact-v1') return false;
  return !nonblockingPackage(
    db,
    record.scope.projectId,
    record.item.id,
    record.package.id,
    run,
    true,
  );
}

export function taskC4WaitPolicy(db: AppDb, project: string, run: string, delivered = true) {
  return (id: string, packageId: string) =>
    taskC4Protocol(db, project, run) === 'impact-v1' &&
    !nonblockingPackage(db, project, id, packageId, run, delivered);
}

function nonblockingPackage(
  db: AppDb,
  project: string,
  id: string,
  packageId: string,
  run: string,
  delivered: boolean,
) {
  const policy = db.getSetting<Policy | undefined>(key(project, id), undefined, { strict: true });
  const job = policy?.review ? new C4SemanticStore(db).get(policy.review) : undefined;
  return (
    policy?.version === 1 &&
    policy.packageId === packageId &&
    policy.runId === run &&
    job?.state === 'verified' &&
    (!delivered || job.delivered) &&
    !!job.reviewer &&
    job.projectId === project &&
    job.runId === run &&
    job.packageId === id &&
    (policy.blocking === false || job.verdict?.category === 'aligned') &&
    c4ReviewedImplementationAligned(job.verdict)
  );
}
