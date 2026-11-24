import type { AppDb, CoordinationOperation, CoordinationRef } from '@skaro/core';
import type { TaskParkReceipt } from '../shared/task-park';
import { currentTransition } from './task-lifecycle-journal';
import { coordinationHash } from './project-coordinator-request';

export function parkCommandId(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value))
    throw new Error('Invalid task lifecycle request ID');
  return `park:${value}`;
}
export function parkDelivery(db: AppDb, project: string, id: string, subject: CoordinationRef) {
  return {
    evidence: (value: unknown) => {
      const receipt = value as TaskParkReceipt;
      return { code: `task_${receipt.status}`, refs: [{ ...subject, version: receipt.revision }] };
    },
    replay: () => {
      const evidence = db.coordination.getOperation(project, id)?.evidence;
      const revision = evidence?.refs?.[0]?.version;
      if (
        (evidence?.code !== 'task_stopped' && evidence?.code !== 'task_paused') ||
        typeof revision !== 'number'
      )
        throw new Error('Task lifecycle receipt is missing');
      return {
        requestId: id.slice(5),
        revision,
        status: evidence.code === 'task_stopped' ? 'stopped' : 'paused',
      } satisfies TaskParkReceipt;
    },
  };
}
export function reconcileParkDelivery(db: AppDb, operation: CoordinationOperation) {
  if (
    operation.action !== 'ipc.task.park' ||
    operation.subject.kind !== 'task' ||
    operation.state !== 'uncertain' ||
    !operation.id.startsWith('park:')
  )
    return false;
  const { projectId: project, subject } = operation;
  const entry = currentTransition(db, project, subject.id);
  if (
    !entry ||
    entry.target === 'in_progress' ||
    entry.phase !== 'settled' ||
    !entry.commandId ||
    parkCommandId(entry.commandId) !== operation.id ||
    operation.inputHash !== coordinationHash([project, subject.id, entry.target, entry.commandId])
  )
    return false;
  db.coordination.reconcile(project, operation.id, {
    state: 'succeeded',
    expectedRevision: operation.revision,
    evidence: { code: `task_${entry.target}`, refs: [{ ...subject, version: entry.revision }] },
  });
  return true;
}
