import type { AppDb, CoordinationOperation } from '@skaro/core';
import type { ToolResult } from '@skaro/mcp-server';
import { CompletionStore } from './completion-store';
import { coordinationHash } from './project-coordinator-request';
import type { SubmissionIdentity } from './submission-context';
import { isDeepStrictEqual } from 'node:util';

interface SubmissionReceipt extends SubmissionIdentity {
  state: 'succeeded' | 'failed';
  reply: ToolResult;
}
const key = (project: string, id: string) => `submission.receipt.${project}.${id}`;

export function recordSubmissionReceipt(db: AppDb, proof: SubmissionReceipt): void {
  const operation = db.coordination.getOperation(proof.projectId, proof.operationId);
  if (!matches(db, operation, proof))
    throw new Error('Submission receipt is outside its admitted operation');
  // Compare the same JSON representation the durable settings store actually retains.
  const durable = JSON.parse(JSON.stringify(proof)) as SubmissionReceipt;
  const name = key(proof.projectId, proof.operationId);
  const saved = db.getSetting<SubmissionReceipt | undefined>(name, undefined, { strict: true });
  if (saved) {
    if (isDeepStrictEqual(saved, durable)) return;
    throw new Error('The original submission already has a different terminal receipt');
  }
  if (!db.settings.compareAndSet(name, undefined, durable))
    throw new Error('Submission receipt changed while recording its outcome');
}

function matches(
  db: AppDb,
  operation: CoordinationOperation | undefined,
  proof: SubmissionIdentity,
) {
  const run = db.getRun(proof.runId);
  return (
    run?.projectId === proof.projectId &&
    run.taskId === proof.taskId &&
    !!operation?.claimId &&
    operation?.action === 'mcp.submit_result' &&
    operation.projectId === proof.projectId &&
    operation.subject.kind === 'task' &&
    operation.subject.id === proof.taskId &&
    operation.inputHash === proof.inputHash &&
    operation.id === proof.operationId
  );
}

/** A terminal handler receipt or exact accepted SHA is evidence; checked criteria are not. */
export function submissionReceipt(db: AppDb, projectId: string, operationId: string) {
  const operation = db.coordination.getOperation(projectId, operationId);
  if (!operation || operation.action !== 'mcp.submit_result' || operation.subject.kind !== 'task')
    return;
  const saved = db.getSetting<SubmissionReceipt | undefined>(
    key(projectId, operationId),
    undefined,
    {
      strict: true,
    },
  );
  if (saved && matches(db, operation, saved)) return saved;
  const result = new CompletionStore(db, projectId).result(operation.subject.id);
  if (!result?.submission || !matches(db, operation, result.submission)) return;
  return {
    ...result.submission,
    state: 'succeeded' as const,
    reply: {
      text: 'The exact accepted result is recorded. Inspect its pending projection and current task status; this receipt does not assert publication or authorize repeating submission.',
      structuredContent: {
        submission: {
          accepted: true,
          head: result.head,
          pendingProjection: !!result.pendingReview,
        },
      },
    },
  };
}

export function confirmSubmissionReceipt(
  db: AppDb,
  projectId: string,
  operationId: string,
): ToolResult | undefined {
  const proof = submissionReceipt(db, projectId, operationId);
  if (!proof) return;
  const operation = db.coordination.getOperation(projectId, operationId)!;
  if (!['uncertain', 'succeeded', 'failed'].includes(operation.state)) return;
  if (operation.state === 'uncertain')
    db.coordination.reconcile(projectId, operationId, {
      expectedRevision: operation.revision,
      state: proof.state,
      evidence: {
        code: 'submission_receipt_verified',
        refs: [operation.subject, { kind: 'run', id: proof.runId }],
        fingerprint: coordinationHash(proof),
      },
    });
  return {
    ...proof.reply,
    structuredContent: {
      ...proof.reply.structuredContent,
      coordination: {
        operationId,
        state: proof.state,
        registrationConfirmed: true,
        retryAllowed: false,
      },
    },
  };
}

export function recoverSubmissionReceipts(db: AppDb, projectId: string): void {
  for (const operation of db.coordination.pending(projectId))
    if (operation.action === 'mcp.submit_result' && operation.state === 'uncertain')
      confirmSubmissionReceipt(db, projectId, operation.id);
}
