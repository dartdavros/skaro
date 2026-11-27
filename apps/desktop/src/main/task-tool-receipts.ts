import { type AppDb } from '@skaro/core';
import { operationFailure, type SkaroScope, type ToolResult } from '@skaro/mcp-server';
import { coordinationHash } from './project-coordinator-request';
import { submissionContext } from './submission-context';
import { compactSubmissionReply } from './task-submission-operation';
import { withMergeOperation } from './merge-operation-context';
import { CompletionStore } from './completion-store';

interface Receipt {
  name: string;
  owner: string;
  runId?: string;
  inputHash: string;
  state: 'started' | 'returned' | 'failed';
  result?: ToolResult;
}
const key = (project: string, id: string) => `task.tool.${project}.${id}`;
function outcome(id: string, row: Receipt): ToolResult {
  return (
    row.result ?? {
      text:
        row.state === 'started'
          ? 'Delivery is unconfirmed. Inspect the task before repeating the action.'
          : 'This request already returned. Inspect the task history for the original result.',
      isError: row.state !== 'returned',
      structuredContent: { operationId: id, state: row.state },
    }
  );
}

/** Bind transport retries to the exact task request. Never store arguments, secrets or tool output from other tools. */
export async function executeTaskTool(
  db: AppDb,
  scope: SkaroScope,
  name: string,
  args: Record<string, unknown>,
  id: string,
  effect: () => Promise<ToolResult>,
): Promise<ToolResult> {
  const owner = scope.kind === 'integration' ? scope.integrationId : scope.taskId;
  if (!owner) throw new Error('Missing task or integration identity');
  const inputHash = coordinationHash({ name, scope, args });
  const record: Receipt = { name, owner, runId: scope.runId, inputHash, state: 'started' };
  const path = key(scope.projectId, id);
  if (!db.settings.compareAndSet(path, undefined, record)) {
    const prior = db.getSetting<Receipt | undefined>(path, undefined, { strict: true });
    if (!prior || prior.inputHash !== inputHash) throw new Error('Tool request identity changed');
    return outcome(id, prior);
  }
  let reply: ToolResult;
  try {
    reply =
      name === 'submit_result' && scope.runId && scope.taskId
        ? compactSubmissionReply(
            await submissionContext.run(
              {
                projectId: scope.projectId,
                taskId: scope.taskId,
                runId: scope.runId,
                inputHash,
                operationId: id,
              },
              effect,
            ),
          )
        : name === 'merge_task'
          ? await withMergeOperation(scope, args, id, effect)
          : await effect();
  } catch (error) {
    reply = operationFailure(error, name);
  }
  db.setSetting(path, {
    ...record,
    state: reply.isError ? 'failed' : 'returned',
    ...(['submit_result', 'merge_task'].includes(name) ? { result: reply } : {}),
  });
  return reply;
}

export function inspectTaskTool(
  db: AppDb,
  scope: SkaroScope,
  name: string,
  id: string,
): ToolResult | undefined {
  const row = db.getSetting<Receipt | undefined>(key(scope.projectId, id), undefined, {
    strict: true,
  });
  if (!row) return;
  if (row.name !== name || (scope.kind === 'task' && row.owner !== scope.taskId))
    return { text: 'The original request belongs to another task or tool.', isError: true };
  if (name === 'submit_result' && row.state === 'started') {
    const result = new CompletionStore(db, scope.projectId).result(row.owner);
    if (result?.submission?.operationId === id && result.submission.inputHash === row.inputHash)
      return {
        text: 'The accepted result was saved.',
        structuredContent: { head: result.head, pendingReview: !!result.pendingReview },
      };
  }
  return outcome(id, row);
}
