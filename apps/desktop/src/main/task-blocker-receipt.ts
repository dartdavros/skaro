import type { AppDb, CoordinationBlocker, IncidentSubscription } from '@skaro/core';
import type { ToolResult } from '@skaro/mcp-server';
import { TaskExecution } from './task-execution';
import { isIncidentOwnerPause } from '@skaro/mcp-server';

interface BlockerReportProof {
  blockerId: string;
  taskId: string;
  runId: string;
  intent: number;
}
const proofKey = (operation: string) => `blocker.report.${operation}`;

/** Persist the acknowledgement with execution state, before returning success to either transport. */
export function recordTaskBlocker(
  db: AppDb,
  row: CoordinationBlocker,
  subscription: IncidentSubscription,
  reason: string,
  operationId?: string,
): void {
  db.settings.atomic(() => {
    const execution = new TaskExecution(db, subscription.runId);
    if (execution.intentVersion() !== subscription.intent)
      throw new Error('Task execution intent changed before blocker registration');
    execution.block(reason, row.id);
    if (row.protocol && isIncidentOwnerPause(row.protocol.cause, row.protocol.code))
      execution.stop();
    if (operationId)
      db.setSetting(proofKey(operationId), {
        blockerId: row.id,
        taskId: subscription.taskId,
        runId: subscription.runId,
        intent: subscription.intent,
      });
  });
}

export function taskBlockerReceipt(
  db: AppDb,
  projectId: string,
  operationId: string,
): ToolResult | undefined {
  const proof = db.getSetting<BlockerReportProof | undefined>(proofKey(operationId), undefined);
  if (!proof) return;
  const operation = db.coordination.getOperation(projectId, operationId);
  const row = db.coordination.blockers.get(projectId, proof.blockerId);
  if (
    operation?.action !== 'mcp.report_task_blocker' ||
    operation.subject.kind !== 'task' ||
    operation.subject.id !== proof.taskId ||
    !row?.protocol?.subscriptions.some(
      (s) => s.taskId === proof.taskId && s.runId === proof.runId && s.intent === proof.intent,
    )
  )
    return;
  const execution = new TaskExecution(db, proof.runId).read();
  return {
    text: `The blocker report is recorded as ${row.id}; current incident state: ${row.state}. Read the current project state before continuing. Registration does not accept, complete or merge the task.`,
    structuredContent: {
      blocker: {
        recorded: true,
        id: row.id,
        state: row.state,
        taskId: proof.taskId,
        runId: proof.runId,
        continuationSuspended: execution.blockedIncident === row.id,
      },
      coordination: { operationId, registrationConfirmed: true },
    },
  };
}

/** An interrupted report is confirmed only by its exact durable effect, never by model prose. */
export function confirmTaskBlockerReport(
  db: AppDb,
  projectId: string,
  operationId: string,
): ToolResult | undefined {
  const receipt = taskBlockerReceipt(db, projectId, operationId);
  if (!receipt) return;
  const operation = db.coordination.getOperation(projectId, operationId)!;
  const proof = db.getSetting<BlockerReportProof | undefined>(proofKey(operationId), undefined)!;
  if (operation.state === 'uncertain')
    db.coordination.reconcile(projectId, operationId, {
      expectedRevision: operation.revision,
      state: 'succeeded',
      evidence: {
        code: 'task_blocker_report_verified',
        refs: [{ kind: 'blocker', id: proof.blockerId }],
        fingerprint: operation.inputHash,
      },
    });
  return receipt;
}

export function recoverTaskBlockerReports(db: AppDb, projectId: string): void {
  for (const operation of db.coordination.pending(projectId))
    if (operation.action === 'mcp.report_task_blocker' && operation.state === 'uncertain')
      confirmTaskBlockerReport(db, projectId, operation.id);
}
