import type { CoordinationOperation } from '@skaro/core';
import type { ToolResult } from '@skaro/mcp-server';
import { CoordinationPending } from './project-coordinator-errors';

/** Reporting a blocker must remain available while unrelated task controls await reconciliation. */
export function coordinationToolScopeKey(
  tool: string,
  operationId: string,
  ordinary: string,
): string {
  return tool === 'report_task_blocker' ? `blocker-report:${operationId}` : ordinary;
}

/** A saved dispatch state is a receipt, not an operational service exception or retry authority. */
export async function coordinationToolReceipt(
  operation: string,
  effect: () => Promise<ToolResult>,
  confirm?: () => ToolResult | undefined,
): Promise<ToolResult> {
  try {
    return await effect();
  } catch (error) {
    const confirmed = confirm?.();
    if (confirmed) return confirmed;
    if (!(error instanceof CoordinationPending)) throw error;
    return pendingReceipt(operation, error.operation);
  }
}

function pendingReceipt(operation: string, saved: CoordinationOperation): ToolResult {
  const pending = ['queued', 'dispatching'].includes(saved.state);
  const nextStep =
    saved.state === 'uncertain'
      ? operation === 'submit_result'
        ? `Call reconcile_task_submission with operation_id="${saved.id}" to inspect the original durable outcome. Do not repeat submit_result or infer acceptance from checked criteria.`
        : 'Read the actual project state and saved evidence before any new action. The controller must reconcile the outcome; do not repeat an unknown effect or claim it succeeded.'
      : pending
        ? 'The handler has no confirmed completion receipt. Read the project context for the actual result; do not claim the requested effect or repeat this operation blindly.'
        : 'Inspect the saved evidence and actual project state. This receipt grants no retry permission.';
  return {
    text: `Project operation ${saved.id} is ${saved.state}. ${nextStep}`,
    isError: true,
    structuredContent: {
      failure: {
        category: pending ? 'coordination_pending' : `coordination_${saved.state}`,
        operation,
        message: saved.state,
        nextStep,
      },
      coordination: {
        operationId: saved.id,
        state: saved.state,
        evidence: saved.evidence,
        retryAllowed: false,
      },
    },
  };
}
