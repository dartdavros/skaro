import type { AppDb } from '@skaro/core';
import { coordinationHash } from './project-coordinator-request';
import { incidentApprovalProof } from './incident-reply-proof';

/** Run only behind the singleton recovery fence. Exact original IPC hashes bind the evidence. */
export function recoverIncidentOperations(db: AppDb, project: string): void {
  const decisions = db.coordination.decisions.list(project).filter((d) => d.kind === 'approval');
  for (const operation of db.coordination.pending(project)) {
    if (
      operation.state !== 'uncertain' ||
      !['ipc.task.respond', 'ipc.incidents.answer'].includes(operation.action)
    )
      continue;
    for (const decision of decisions) {
      const blocker = db.coordination.blockers.get(project, decision.subject.id);
      if (!blocker) continue;
      for (const choice of ['allow_once', 'deny']) {
        const answer = { kind: 'approval', choice };
        let args: unknown[];
        if (operation.action === 'ipc.task.respond') {
          if (
            operation.subject.kind !== 'task' ||
            !blocker.protocol?.subscriptions.some((s) => s.taskId === operation.subject.id)
          )
            continue;
          args = [project, operation.subject.id, `coordinator:${decision.id}`, answer];
        } else args = [project, decision.id, answer];
        if (coordinationHash(args) !== operation.inputHash) continue;
        const proof = incidentApprovalProof(db, project, decision.id, choice);
        if (!proof) continue;
        db.coordination.reconcile(project, operation.id, {
          expectedRevision: operation.revision,
          state: proof === 'not_dispatched' ? 'failed' : 'succeeded',
          evidence: {
            code:
              proof === 'not_dispatched'
                ? 'owner_decision_not_dispatched'
                : 'owner_decision_verified',
            refs: [{ kind: 'decision', id: decision.id }],
            fingerprint: operation.inputHash,
          },
        });
      }
    }
  }
}
