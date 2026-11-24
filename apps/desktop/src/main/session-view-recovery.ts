import type { AppDb, CoordinationOperation } from '@skaro/core';

/** These receipts cover returning a view to a renderer. C4 and handoff have their own journals. */
export function isSessionView(operation: CoordinationOperation) {
  const { mode, action, subject, scopeKey } = operation;
  return (
    mode === 'observation' &&
    (subject.kind === 'task' || subject.kind === 'chat') &&
    action === `ipc.${subject.kind}.open` &&
    scopeKey === `observation:${subject.kind}:${subject.id}`
  );
}

export function recoverSessionView(db: AppDb, operation: CoordinationOperation) {
  if (!isSessionView(operation) || operation.state !== 'uncertain') return false;
  db.coordination.reconcile(operation.projectId, operation.id, {
    expectedRevision: operation.revision,
    state: 'failed',
    evidence: { code: 'session_view_not_returned', refs: [operation.subject] },
  });
  return true;
}
