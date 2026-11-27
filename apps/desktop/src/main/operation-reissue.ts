import type { AppDb, CoordinationOperation } from '@skaro/core';

export function mayReissueUndispatched(operation: CoordinationOperation): boolean {
  return (
    operation.state === 'rejected' &&
    !operation.claimId &&
    [
      'restart_requires_new_request',
      'stale_project_version',
      'submission_recheck_required',
    ].includes(operation.evidence?.code ?? '')
  );
}

export const REISSUE_UNDISPATCHED =
  'The original handler did not run. Recheck the current task inputs and issue a fresh tool call for the authorized work.';

export function taskAcceptanceRecoveryNote(db: AppDb, project: string, task: string): string {
  const journal = db.coordination.latestTaskAcceptance(project, task);
  const undispatched = journal.filter(mayReissueUndispatched);
  if (!undispatched.length) return '';
  return (
    'Coordinator recovery evidence for this task: ' +
    undispatched.map(({ action, id }) => `${action} (${id}) never dispatched`).join(', ') +
    '. ' +
    REISSUE_UNDISPATCHED +
    ' Use the current checkout and saved verification evidence. Continue through review and submission when the owner has authorized it. Ask with ask_owner for any concrete decision still required.'
  );
}
