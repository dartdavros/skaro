import type { AppDb, ResourceLease } from '@skaro/core';
import { TaskRunProcesses } from './task-run-processes';
import { resourcesFor } from './resource-execution';

/** Only a retained native process admitted to a durable, same-project audit chat is eligible. */
export function auditProcessRecoveryKey(
  project: string,
  lease: Pick<ResourceLease, 'projectId' | 'ownerId' | 'state' | 'checkpoint'>,
  chat: { id: string; projectId: string } | undefined,
  audit: unknown,
) {
  if (
    !chat ||
    chat.projectId !== project ||
    lease.projectId !== project ||
    lease.ownerId !== `chat:${chat.id}` ||
    lease.checkpoint !== `process:chat.${chat.id}` ||
    lease.state !== 'retained' ||
    typeof audit !== 'string' ||
    !audit
  )
    return;
  return `chat.${chat.id}`;
}

/** Startup is before new native dispatch. Never release an unknown owner by age or idle state. */
export async function recoverC4AuditProcesses(db: AppDb, project: string) {
  if (!db.getProject(project) || (db.shell.projectScope && db.shell.projectScope !== project))
    throw new Error('Audit process recovery is outside project scope');
  const resources = resourcesFor(db);
  if (!resources) return;
  const processes = new TaskRunProcesses(db),
    keys = new Set<string>();
  for (const lease of db.admission.all()) {
    if (lease.projectId !== project || !lease.ownerId.startsWith('chat:')) continue;
    const id = lease.ownerId.slice(5);
    const key = auditProcessRecoveryKey(
      project,
      lease,
      db.getChat(id),
      db.getSetting(`c4.audit.chat.${id}`, undefined, { strict: true }),
    );
    if (key) keys.add(key);
  }
  for (const key of keys) {
    // The existing OS executor checks recorded PID/birth and its process tree before returning.
    await processes.stop(key);
    resources.reconcileProcess(project, key);
    db.addEvent(project, 'c4_audit_process_reconciled', { processKey: key });
  }
}
