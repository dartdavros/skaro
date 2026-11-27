import type { AppDb } from '@skaro/core';
import { operationFailure, type SkaroScope, type Tool, type ToolResult } from '@skaro/mcp-server';
import { background } from './background/client';
import { confirmSubmissionReceipt, recordSubmissionReceipt } from './task-submission-receipt';
import { mayReissueUndispatched, REISSUE_UNDISPATCHED } from './operation-reissue';

/** Reconcile only recorded outcomes. No shell, Git, model, acceptance or service executor runs here. */
export async function reconcileTaskSubmission(
  db: AppDb,
  dataDir: string,
  scope: SkaroScope,
  id: string,
): Promise<ToolResult> {
  if (scope.importId || !['task', 'project_chat'].includes(scope.kind))
    return {
      text: 'Submission recovery requires a task or ordinary project conversation.',
      isError: true,
    };
  if (db.shell.projectScope && db.shell.projectScope !== scope.projectId)
    throw new Error('Submission recovery is outside verification scope');
  const op = db.coordination.getOperation(scope.projectId, id);
  if (
    !op ||
    op.action !== 'mcp.submit_result' ||
    op.subject.kind !== 'task' ||
    (scope.kind === 'task' && scope.taskId !== op.subject.id)
  )
    return { text: 'The original submission is outside this conversation scope.', isError: true };
  if (mayReissueUndispatched(op))
    return {
      text: REISSUE_UNDISPATCHED,
      structuredContent: {
        coordination: {
          operationId: id,
          state: op.state,
          dispatched: false,
          freshCallAllowed: true,
        },
      },
    };
  let receipt = confirmSubmissionReceipt(db, scope.projectId, id);
  if (!receipt && op.state === 'uncertain') {
    const peers = db.coordination.matching(scope.projectId, op.action, op.inputHash);
    for (const run of db.listRuns(scope.projectId, op.subject.id, { includeRetired: true })) {
      const proof = await background(dataDir, 'submission.proof', {
        projectId: scope.projectId,
        run,
        operation: op,
        peers,
      });
      if (!proof) continue;
      recordSubmissionReceipt(db, {
        operationId: id,
        projectId: scope.projectId,
        taskId: op.subject.id,
        runId: proof.runId,
        inputHash: op.inputHash,
        state: 'failed',
        reply: {
          text: 'The original native call returned an exact recorded terminal failure. This acknowledgement does not assert or undo acceptance/publication. Existing criteria, code and any separately recorded result are preserved. Recheck current task state before a fresh submission.',
          isError: true,
          structuredContent: { submission: { legacyFailureVerified: true, ...proof } },
        },
      });
      receipt = confirmSubmissionReceipt(db, scope.projectId, id);
      break;
    }
  }
  if (!receipt)
    return {
      text: 'No terminal receipt was found for this submission. Checked criteria alone do not prove its outcome. Inspect the actual result and continue independent work.',
      isError: true,
      structuredContent: {
        coordination: { operationId: id, state: op.state, retryAllowed: false },
      },
    };
  const rejected: string[] = [];
  for (const queued of db.coordination.pending(scope.projectId)) {
    if (
      op.state !== 'uncertain' ||
      queued.action !== op.action ||
      queued.subject.kind !== 'task' ||
      queued.subject.id !== op.subject.id ||
      queued.inputHash !== op.inputHash ||
      queued.state !== 'queued' ||
      queued.createdAt < op.createdAt
    )
      continue;
    db.coordination.reject(scope.projectId, queued.id, {
      expectedRevision: queued.revision,
      evidence: {
        code: 'submission_recheck_required',
        refs: [op.subject, { kind: 'command', id }],
      },
    });
    rejected.push(queued.id);
  }
  return {
    ...receipt,
    isError: false,
    structuredContent: {
      ...receipt.structuredContent,
      recovery: { originalReconciled: true, queuedRejected: rejected, effectsRepeated: false },
    },
  };
}

export function submissionRecoveryTool(db: AppDb, dataDir: string): Tool<SkaroScope> {
  return {
    name: 'reconcile_task_submission',
    description:
      'Inspect the exact original submit_result operation and reconcile it only from its durable receipt, accepted SHA or uniquely matching native failure. Does not repeat submission, change criteria, publish or start services. Use this for coordination_uncertain before considering a fresh submission.',
    inputSchema: {
      type: 'object',
      properties: { operation_id: { type: 'string', minLength: 1 } },
      required: ['operation_id'],
      additionalProperties: false,
    },
    available: (scope) =>
      (scope.kind === 'task' && !!scope.taskId) ||
      (scope.kind === 'project_chat' && !!scope.chatId && !scope.importId),
    call: async (args, scope) => {
      if (typeof args.operation_id !== 'string' || !args.operation_id.trim())
        return { text: 'The original operation_id is required.', isError: true };
      try {
        return await reconcileTaskSubmission(db, dataDir, scope, args.operation_id);
      } catch (error) {
        return operationFailure(error, 'reconcile_task_submission');
      }
    },
  };
}
