import type { AppDb } from '@skaro/core';
import { operationFailure, type SkaroScope, type ToolResult } from '@skaro/mcp-server';
import { submissionContext } from './submission-context';
import { recordSubmissionReceipt } from './task-submission-receipt';
import { createHash } from 'node:crypto';

/** Large diagnostics cannot become a second transport failure after the actual handler ended. */
export function compactSubmissionReply(reply: ToolResult): ToolResult {
  const encoded = JSON.stringify(reply);
  if (Buffer.byteLength(encoded) <= 64 * 1024) return reply;
  return {
    text:
      reply.text.slice(0, 8192) +
      '\n[Submission response truncated; inspect the saved task result and operation receipt.]',
    ...(reply.isError ? { isError: true } : {}),
    structuredContent: {
      submission: {
        responseTruncated: true,
        originalBytes: Buffer.byteLength(encoded),
        responseHash: createHash('sha256').update(encoded).digest('hex'),
      },
    },
  };
}

/** Known handler failure is terminal with possible partial effects; it is not a lost dispatch. */
export async function submissionOperation(
  db: AppDb,
  scope: SkaroScope,
  operationId: string,
  effect: () => Promise<ToolResult>,
): Promise<ToolResult> {
  if (!scope.taskId || !scope.runId) return effect();
  const operation = db.coordination.getOperation(scope.projectId, operationId);
  if (operation?.action !== 'mcp.submit_result' || operation.subject.id !== scope.taskId)
    throw new Error('Submission operation is not admitted');
  const identity = {
    projectId: scope.projectId,
    taskId: scope.taskId,
    runId: scope.runId,
    operationId,
    inputHash: operation.inputHash,
  };
  return submissionContext.run(identity, async () => {
    let reply: ToolResult;
    try {
      reply = await effect();
    } catch (error) {
      reply = operationFailure(error, 'submit_result');
    }
    reply = compactSubmissionReply(reply);
    recordSubmissionReceipt(db, {
      ...identity,
      state: reply.isError ? 'failed' : 'succeeded',
      reply,
    });
    return reply;
  });
}
