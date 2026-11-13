import type { AppDb, EventRecord } from '@skaro/core';
import type { BackgroundJob } from '../shared/background';
import type { ProjectActivityPage } from '../shared/project-activity';
import { backgroundWork } from './background-work';
import { c4AuditJob } from '../shared/c4-audit-job';

const archiveJobs = new Set(['environment.task', 'environment.merge', 'merge.retire']);
export function attachProjectActivityArchive(db: AppDb) {
  backgroundWork.attachArchive((job) => {
    if (!job.projectId || !archiveJobs.has(job.what)) return;
    if (db.shell.projectScope && db.shell.projectScope !== job.projectId)
      throw new Error('Activity is outside project scope');
    // Errors retain their failed state, never raw stderr/secret text in the shared archive.
    const { error: _error, ...record } = job;
    void _error;
    db.addEvent(job.projectId, 'background_result', { job: record });
  });
}
function projectJob(db: AppDb, event: EventRecord): BackgroundJob | undefined {
  const d = event.data,
    base = {
      id: `event:${event.id}`,
      projectId: event.projectId,
      state: 'done' as const,
      startedAt: event.at,
      endedAt: event.at,
    };
  if (event.kind === 'c4_audit_state') {
    const audit = d.audit as import('../shared/c4-audit').C4Audit | undefined;
    if (
      audit?.projectId === event.projectId &&
      ['done', 'partial', 'error', 'conflict', 'stopped'].includes(audit.state)
    )
      return c4AuditJob(audit, false);
  }
  if (event.kind === 'c4_application_verified')
    return { ...base, what: 'c4.applied', resourceId: String(d.packageId) };
  if (event.kind === 'background_result') {
    const job = d.job as BackgroundJob | undefined;
    if (
      !job ||
      job.projectId !== event.projectId ||
      !archiveJobs.has(job.what) ||
      !['done', 'failed'].includes(job.state)
    )
      return;
    // The recent in-memory row and durable row are the same completed job.
    return { ...job };
  }
  if (event.kind === 'waiting')
    return {
      ...base,
      what: 'decision.requested',
      taskId: typeof d.task === 'string' ? d.task : undefined,
    };
  if (
    event.kind === 'cache_evicted' &&
    d.afterBytes === 0 &&
    Number(d.beforeBytes) > 0 &&
    typeof d.resource === 'string'
  )
    return { ...base, what: 'cache.evicted', resourceId: d.resource };
  if (
    event.kind === 'resource_cache' &&
    d.state === 'released' &&
    typeof d.resourceId === 'string' &&
    Number.isSafeInteger(d.logicalBytesRemoved)
  )
    return { ...base, what: 'resource.released', resourceId: d.resourceId };
  if (
    event.kind === 'resource_lifecycle' &&
    d.state === 'verified' &&
    d.step === 'worktree.remove' &&
    typeof d.resource === 'string'
  )
    return { ...base, what: 'resource.released', resourceId: d.resource };
  if (event.kind === 'task_unblocked' && typeof d.task === 'string')
    return { ...base, what: 'task.unblocked', taskId: d.task };
  if (event.kind === 'incident_resolved' && typeof d.incident === 'string') {
    const incident = db.coordination.blockers.get(event.projectId, d.incident);
    const operation =
      incident?.protocol?.operationId &&
      db.coordination.getOperation(event.projectId, incident.protocol.operationId);
    if (
      incident?.state === 'resolved' &&
      incident.protocol?.condition === 'environment-ready' &&
      operation &&
      operation.state === 'succeeded'
    )
      return { ...base, what: 'environment.started', resourceId: incident.subject.id };
  }
}
/** Bounded keyset scan over the existing durable project ledger; technical retries do not become rows. */
export function projectActivityPage(
  db: AppDb,
  projectId: string,
  cursor?: number,
): ProjectActivityPage {
  if ((db.shell.projectScope && db.shell.projectScope !== projectId) || !db.getProject(projectId))
    throw new Error('Activity project scope invalid');
  const jobs: BackgroundJob[] = [];
  let nextCursor = cursor;
  for (let page = 0; page < 5; page++) {
    const source = db.events.page(projectId, nextCursor, 50);
    for (const event of source.events) {
      const job = projectJob(db, event);
      if (job) jobs.push(job);
    }
    nextCursor = source.nextCursor;
    if (jobs.length >= 30 || nextCursor === undefined) break;
  }
  return { jobs, ...(nextCursor !== undefined ? { nextCursor } : {}) };
}
